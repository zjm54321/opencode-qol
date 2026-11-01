#!/usr/bin/env bun
// SPDX-License-Identifier: GPL-3.0-or-later
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"

export type Request = { operation: "clear" | "restore"; dbPath: string; sessionID: string; directory: string; backupDir?: string; backupPath?: string }
type Result = { ok: true; changedMessages: number; changedEvents: number; removedFields: number } | { ok: false; error: string }
type ObjectValue = Record<string, any>
type Row = { id: string; type: string; data: string; [key: string]: unknown }
type PartRow = { message_id: string; session_id: string; ordinal: bigint; type: string; data: string; [key: string]: unknown }
type Entry = { table: "session_message" | "event"; row: Row } | { table: "session_part"; row: PartRow }
type Change = ({ table: "session_message" | "event"; id: string } | { table: "session_part"; messageID: string; ordinal: string }) & { original: string; cleaned: string; removedFields: number }
class Refusal extends Error {}
function requireSafe(condition: unknown, message: string): asserts condition { if (!condition) throw new Refusal(message) }
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value)
const own = (value: ObjectValue, key: string) => Object.hasOwn(value, key)
const encode = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? { sqliteInteger: v.toString() } : v)
const digest = (value: unknown) => createHash("sha256").update(encode(value)).digest("hex")

// Pinned to the six persistence tables in core 2.2.5 (9bbb8ce18c80). A suffix
// ! means NOT NULL; * means primary key. Extra/missing columns fail closed.
const schema: Record<string, string> = {
  session_v2: "id:text* project_id:text! workspace_id:text parent_id:text fork_session_id:text fork_boundary:text slug:text! directory:text! path:text title:text version:text! share_url:text summary_additions:integer summary_deletions:integer summary_files:integer summary_diffs:text metadata:text cost:real! tokens_input:integer! tokens_output:integer! tokens_reasoning:integer! tokens_cache_read:integer! tokens_cache_write:integer! revert:text permission:text agent:text model:text time_created:integer! time_updated:integer! time_busy:integer time_idle:integer time_viewed:integer idle_outcome:text time_compacting:integer time_archived:integer time_suspended:integer resume_attempts:integer!",
  session_message: "id:text* session_id:text! type:text! seq:integer! time_created:integer! time_updated:integer! data:text!",
  session_part: "message_id:text!* session_id:text! ordinal:integer!* type:text! call_id:text time_created:integer! time_updated:integer! data:text!",
  session_inbox: "id:text* session_id:text! type:text! payload:text! delivery:text! enqueued_seq:integer! time_created:integer!",
  event: "id:text* aggregate_id:text! seq:integer! created:integer! type:text! data:text!",
  event_sequence: "aggregate_id:text* seq:integer! owner_id:text",
}
function verifySchema(db: Database) {
  for (const [table, spec] of Object.entries(schema)) {
    const columns = db.query(`PRAGMA table_xinfo("${table}")`).all() as ObjectValue[]
    const actual = columns.map(c => `${c.name}:${String(c.type).toLowerCase()}${c.notnull ? "!" : ""}${c.pk ? "*" : ""}`).sort().join(" ")
    // Migration history may change physical column order, not the schema.
    requireSafe(actual === spec.split(" ").sort().join(" ") && columns.every(c => !c.hidden), "Unsupported database schema")
    const entry = db.query("SELECT type, sql FROM sqlite_schema WHERE name = ?").get(table) as ObjectValue | null
    requireSafe(entry?.type === "table" && !/\bVIRTUAL\b/i.test(entry.sql), "Unsupported database schema")
    if (table === "session_part") requireSafe(Number(columns.find(c => c.name === "message_id")?.pk) === 1 && Number(columns.find(c => c.name === "ordinal")?.pk) === 2, "Unsupported database schema")
  }
  requireSafe(!db.query("SELECT 1 FROM sqlite_schema WHERE name = 'session_pending' LIMIT 1").get(), "Unsupported database schema")
  // Triggers could change unrelated history or timestamps during narrow updates.
  requireSafe(!db.query("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' LIMIT 1").get(), "Database triggers are unsupported")
}
function snapshot(db: Database, id: string) {
  return {
    session: db.query("SELECT * FROM session_v2 WHERE id = ?").get(id) as ObjectValue | null,
    sequence: db.query("SELECT * FROM event_sequence WHERE aggregate_id = ?").get(id) as ObjectValue | null,
    messages: db.query("SELECT * FROM session_message WHERE session_id = ? ORDER BY seq, id").all(id) as Row[],
    // History and projection load parts by message_id, so a foreign session_id
    // cannot hide a part belonging to one of this session's assistant messages.
    parts: db.query("SELECT * FROM session_part AS p WHERE p.session_id = ? OR p.message_id IN (SELECT id FROM session_message WHERE session_id = ?) ORDER BY message_id, ordinal").all(id, id) as PartRow[],
    events: db.query("SELECT * FROM event WHERE aggregate_id = ? ORDER BY seq, id").all(id) as Row[],
  }
}
function parse(raw: string): ObjectValue {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Refusal("Invalid stored JSON") }
  requireSafe(object(value), "Unsupported stored JSON shape")
  return value
}
function guard(db: Database, request: Request, state: ReturnType<typeof snapshot>, directory: string) {
  requireSafe(state.session, "Session does not exist")
  requireSafe(realpathSync(state.session.directory) === directory, "Session directory mismatch")
  requireSafe(state.session.time_suspended === null && state.session.time_compacting === null, "Session has active execution or compaction")
  // time_busy is retained after settlement, not cleared like time_compacting.
  // An idle timestamp at or after that durable claim permits settled sessions.
  requireSafe(state.session.time_busy === null || (state.session.time_idle !== null && state.session.time_busy <= state.session.time_idle), "Session has active execution or compaction")
  requireSafe(state.session.fork_session_id === null && state.session.fork_boundary === null && !db.query("SELECT 1 FROM session_v2 WHERE fork_session_id = ? LIMIT 1").get(request.sessionID), "Fork relationships are unsupported")
  // bus.ts sets owner_id on imported replay/claim, not ordinary local emission.
  // No non-null owner is safe to rewrite independently of its replica.
  requireSafe(state.sequence && state.sequence.owner_id === null, "Missing or replicated/owned event aggregate")
  requireSafe(!db.query("SELECT 1 FROM session_inbox WHERE session_id = ? LIMIT 1").get(request.sessionID), "Session has pending or inbox work")
  const messages = new Map(state.messages.map(row => [row.id, row]))
  const settledTool = (content: ObjectValue) => {
    if (content.type === "tool") requireSafe(["completed", "error"].includes(content.state?.status), "Session has unfinished tool work")
  }
  for (const row of state.messages) {
    const data = parse(row.data)
    if (row.type === "assistant") {
      requireSafe(object(data.time) && typeof data.time.completed === "number", "Session has unfinished assistant work")
      requireSafe(Array.isArray(data.content), "Unsupported assistant content")
      for (const content of data.content) {
        requireSafe(object(content), "Unsupported assistant content")
        settledTool(content)
      }
    }
    if (row.type === "compaction") requireSafe(["completed", "failed"].includes(data.status), "Session has unfinished compaction work")
    if (row.type === "shell") requireSafe(["exited", "timeout", "killed"].includes(data.status), "Session has unfinished shell work")
  }
  for (const row of state.parts) {
    const parent = messages.get(row.message_id)
    requireSafe(parent?.type === "assistant" && parent.session_id === request.sessionID && row.session_id === request.sessionID, "Part message/session identity mismatch")
    requireSafe(typeof row.ordinal === "bigint", "Unsupported part ordinal")
    const data = parse(row.data)
    requireSafe(data.type === row.type, "Part type mismatch")
    settledTool(data)
  }
  for (const row of state.events) {
    requireSafe(parse(row.data).sessionID === request.sessionID, "Event session identity mismatch")
    requireSafe(BigInt(row.seq as bigint) <= BigInt(state.sequence.seq), "Inconsistent event watermark")
  }
}

type Target = { value: ObjectValue; path: string; scope: string; metadata?: { value: ObjectValue; path: string } }
function targets(db: Database, entry: Entry, data: ObjectValue): Target[] {
  const { row, table } = entry
  const result: Target[] = []
  const structural = new Set<string>()
  const containers: { value: ObjectValue; path: string }[] = []
  function nativeScope(owner: unknown) {
    requireSafe(typeof owner === "string" && owner.length > 0, "Missing reasoning owner identity")
    return encode(["assistant", owner, "reasoning-native"])
  }
  function nativeFields(item: ObjectValue, path: string, owner: unknown) {
    for (const key of ["state", "native"]) {
      structural.add(`${path}.${key}`)
      if (!own(item, key)) continue
      requireSafe(object(item[key]), "Unsupported reasoning state")
      result.push({ value: item[key], path: `${path}.${key}`, scope: nativeScope(owner) })
    }
  }
  function reasoning(item: ObjectValue, path: string, owner: unknown) {
    containers.push({ value: item, path })
    nativeFields(item, path, owner)
  }
  function content(items: unknown, prefix: string, owner: unknown) {
    structural.add(prefix)
    requireSafe(Array.isArray(items), "Unsupported reasoning content shape")
    items.forEach((item, i) => {
      requireSafe(object(item), "Unsupported reasoning content shape")
      structural.add(`${prefix}[${i}].type`)
      if (item.type === "tool") {
        structural.add(`${prefix}[${i}].state`)
        structural.add(`${prefix}[${i}].state.status`)
      }
      if (item.type === "reasoning") reasoning(item, `${prefix}[${i}]`, owner)
    })
  }
  function context(key: "providerContext" | "native") {
    const prefix = `$.${key}`
    structural.add(prefix)
    if (!own(data, key)) return
    const ctx = data[key]
    structural.add(`${prefix}.messages`)
    requireSafe(object(ctx), "Unsupported provider context")
    if (key === "providerContext") {
      structural.add(`${prefix}.version`)
      requireSafe(ctx.version === 1, "Unsupported provider context")
    } else if (!own(ctx, "messages")) return // unrelated native checkpoints are opaque
    requireSafe(Array.isArray(ctx.messages), "Unsupported provider context")
    ctx.messages.forEach((message: unknown, i: number) => {
      requireSafe(object(message), "Unsupported provider message")
      structural.add(`${prefix}.messages[${i}].content`)
      if (!Array.isArray(message.content)) {
        requireSafe(typeof message.content === "string", "Unsupported provider content")
        return // canonical user content can be a string
      }
      message.content.forEach((item: unknown, j: number) => {
        requireSafe(object(item), "Unsupported provider content")
        const itemPath = `${prefix}.messages[${i}].content[${j}]`
        structural.add(`${itemPath}.type`)
        if (item.type !== "reasoning") return
        containers.push({ value: item, path: itemPath })
        if (!own(item, "providerMetadata")) return
        requireSafe(object(item.providerMetadata), "Unsupported provider metadata")
        const path = `${itemPath}.providerMetadata`
        for (const [namespace, value] of Object.entries(item.providerMetadata)) {
          requireSafe(object(value), "Unsupported provider namespace")
          // Quoted SQLite JSON labels support punctuation; refuse quote/backslash
          // labels rather than risk addressing a different node.
          requireSafe(!/["\\\u0000-\u001f]/.test(namespace), "Unsupported provider namespace key")
          result.push({ value, path: `${path}.${JSON.stringify(namespace)}`, scope: encode(["compaction", table, row.id, key, i, namespace]), metadata: { value: item.providerMetadata, path } })
        }
      })
    })
  }
  if (table === "session_message") {
    if (row.type === "assistant") {
      structural.add("$.time")
      structural.add("$.time.completed")
      content(data.content, "$.content", row.id)
    }
    if (["compaction", "shell"].includes(row.type)) structural.add("$.status")
    if (row.type === "compaction") { context("providerContext"); context("native") }
  } else if (entry.table === "session_part") {
    structural.add("$.type")
    if (row.type === "reasoning") reasoning(data, "$", entry.row.message_id)
    if (row.type === "tool") { structural.add("$.state"); structural.add("$.state.status") }
  } else {
    structural.add("$.sessionID")
    if (["session.reasoning.started.1", "session.reasoning.ended.1"].includes(row.type)) {
      structural.add("$.assistantMessageID")
      structural.add("$.sessionID")
      requireSafe(!own(data, "reasoningEncryptedContent"), "Unknown encrypted reasoning shape")
      nativeFields(data, "$", data.assistantMessageID)
      for (const key of ["state", "native"]) if (own(data, key)) containers.push({ value: data[key], path: `$.${key}` })
    }
    if (row.type === "session.message.content.updated.1") {
      structural.add("$.messageID")
      structural.add("$.sessionID")
      content(data.content, "$.content", data.messageID)
    }
    if (row.type === "session.compaction.ended.1") {
      structural.add("$.sessionID")
      context("providerContext"); context("native")
    }
  }
  // Only recognized reasoning containers are scanned for unsupported shapes.
  // User examples, tool payloads, errors and unrelated metadata are not targets.
  const allowed = new Set(result.map(t => t.value))
  function inspect(value: unknown) {
    if (!object(value) && !Array.isArray(value)) return
    if (object(value) && own(value, "reasoningEncryptedContent")) requireSafe(allowed.has(value), "Unknown encrypted reasoning shape")
    for (const child of Object.values(value)) inspect(child)
  }
  for (const container of containers) inspect(container.value)
  // Only ambiguous structural selectors or reasoning containers can affect the
  // plan. Duplicate example keys in unrelated objects must remain untouched.
  if (structural.size || containers.length) {
    const duplicates = db.query("SELECT fullkey FROM json_tree(?) WHERE key IS NOT NULL GROUP BY parent, key HAVING count(*) > 1").all(row.data) as { fullkey: string }[]
    for (const { fullkey } of duplicates) {
      requireSafe(!structural.has(fullkey) && !containers.some(c => fullkey === c.path || fullkey.startsWith(c.path + ".") || fullkey.startsWith(c.path + "[")), "Duplicate reasoning JSON keys are unsupported")
    }
  }
  return result
}
function plan(db: Database, state: ReturnType<typeof snapshot>): Change[] {
  const entries: Entry[] = [...state.messages.map(row => ({ row, table: "session_message" as const })), ...state.parts.map(row => ({ row, table: "session_part" as const })), ...state.events.map(row => ({ row, table: "event" as const }))]
  const rows = entries.map(entry => {
    return { entry, targets: targets(db, entry, parse(entry.row.data)) }
  })
  const correlated = new Set<string>()
  for (const { targets } of rows) for (const { value, scope } of targets) {
    if (own(value, "itemId")) requireSafe(typeof value.itemId === "string", "Unsupported reasoning item identity")
    if (!own(value, "reasoningEncryptedContent")) continue
    requireSafe(value.reasoningEncryptedContent === null || typeof value.reasoningEncryptedContent === "string", "Unsupported encrypted reasoning value")
    if (own(value, "itemId")) {
      correlated.add(encode([scope, value.itemId]))
    }
  }
  const changes: Change[] = []
  for (const { entry, targets } of rows) {
    const { row } = entry
    let cleaned = row.data
    let removedFields = 0
    const paths = new Set<string>()
    const removedNamespaces = new Map<string, { count: number; value: ObjectValue }>()
    for (const target of targets) {
      const encrypted = own(target.value, "reasoningEncryptedContent")
      const paired = own(target.value, "itemId") && (encrypted || correlated.has(encode([target.scope, target.value.itemId])))
      const keys = [ ...(encrypted ? ["reasoningEncryptedContent"] : []), ...(paired ? ["itemId"] : []) ]
      if (!keys.length) continue
      removedFields += keys.length
      if (Object.keys(target.value).length === keys.length) {
        paths.add(target.path)
        if (target.metadata) {
          const entry = removedNamespaces.get(target.metadata.path) ?? { count: 0, value: target.metadata.value }
          entry.count++
          removedNamespaces.set(target.metadata.path, entry)
        }
      } else for (const key of keys) paths.add(`${target.path}.${key}`)
    }
    for (const [path, entry] of removedNamespaces) if (entry.count === Object.keys(entry.value).length) paths.add(path)
    // SQLite preserves integer tokens; never serialize parsed history through JS.
    for (const path of paths) cleaned = (db.query("SELECT json_remove(?, ?) AS data").get(cleaned, path) as { data: string }).data
    if (paths.size) changes.push({ ...(entry.table === "session_part" ? { table: entry.table, messageID: entry.row.message_id, ordinal: entry.row.ordinal.toString() } : { table: entry.table, id: entry.row.id }), original: row.data, cleaned, removedFields })
  }
  return changes
}
const changeKey = (c: Change) => encode(c.table === "session_part" ? [c.table, c.messageID, c.ordinal] : [c.table, c.id])
function validOrdinal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|-?[1-9]\d*)$/.test(value) && value.length <= 20
    && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n
}
function validateChange(c: unknown): asserts c is Change {
  requireSafe(object(c) && ["event", "session_message", "session_part"].includes(c.table) && typeof c.original === "string" && typeof c.cleaned === "string" && Number.isSafeInteger(c.removedFields) && c.removedFields > 0, "Invalid backup row")
  if (c.table === "session_part") requireSafe(typeof c.messageID === "string" && validOrdinal(c.ordinal), "Invalid backup part identity")
  else requireSafe(typeof c.id === "string", "Invalid backup row")
}
function privateStat(path: string, directory: boolean) {
  const stat = lstatSync(path)
  requireSafe((directory ? stat.isDirectory() : stat.isFile()) && stat.uid === process.getuid!() && (stat.mode & 0o777) === (directory ? 0o700 : 0o600), "Backup must be private and owned by the current user")
}
function readBackup(path: string) {
  privateStat(path, false)
  privateStat(join(path, ".."), true)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    requireSafe(stat.isFile() && stat.uid === process.getuid!() && (stat.mode & 0o777) === 0o600, "Unsafe backup file")
    return parse(readFileSync(fd, "utf8"))
  } finally { closeSync(fd) }
}

export function runCleanup(input: unknown): Result {
  let db: Database | undefined
  let transaction = false
  try {
    requireSafe(object(input) && ["clear", "restore"].includes(input.operation), "Invalid operation")
    for (const key of ["dbPath", "sessionID", "directory"]) requireSafe(typeof input[key] === "string" && input[key].length > 0, "Missing request identity")
    if (input.operation === "restore") requireSafe(typeof input.backupPath === "string" && input.backupPath.length > 0, "Missing backup path")
    const request = input as Request
    const dbPath = realpathSync(request.dbPath)
    const directory = realpathSync(request.directory)
    const stat = statSync(dbPath, { bigint: true })
    requireSafe(stat.isFile() && statSync(directory).isDirectory(), "Invalid database or directory")
    const identity = { dbPath, directory, sessionID: request.sessionID, device: stat.dev.toString(), inode: stat.ino.toString() }
    // Restore filesystem reads stay outside the writer lock.
    const backup = request.operation === "restore" ? readBackup(request.backupPath!) : undefined
    db = new Database(dbPath, { create: false, strict: true, safeIntegers: true })
    db.exec("PRAGMA busy_timeout = 1000; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL; BEGIN")
    transaction = true
    verifySchema(db)
    const state = snapshot(db, request.sessionID)
    guard(db, request, state, directory)
    let changes: Change[]
    if (request.operation === "clear") {
      changes = plan(db, state)
    } else {
      // Version 1 digests omitted split parts and used the old persistence schema.
      requireSafe(backup?.version === 2, "Unsupported backup version")
      requireSafe(encode(backup.identity) === encode(identity), "Backup identity mismatch")
      requireSafe(backup.watermark === encode(state.sequence) && backup.postDigest === digest(state), "Restore conflict: session changed since cleanup")
      requireSafe(Array.isArray(backup.changes) && backup.changes.length > 0, "Invalid backup changes")
      changes = backup.changes
      const ids = new Set<string>()
      for (const c of changes) {
        validateChange(c)
        requireSafe(!ids.has(changeKey(c)), "Duplicate backup row")
        ids.add(changeKey(c))
        const row = c.table === "session_part" ? state.parts.find(row => row.message_id === c.messageID && row.ordinal.toString() === c.ordinal) : (c.table === "event" ? state.events : state.messages).find(row => row.id === c.id)
        requireSafe(row?.data === c.cleaned, "Restore conflict: post-image changed")
      }
      const originals = new Map(changes.map(c => [changeKey(c), c.original]))
      const original = {
        ...state,
        messages: state.messages.map(row => ({ ...row, data: originals.get(encode(["session_message", row.id])) ?? row.data })),
        parts: state.parts.map(row => ({ ...row, data: originals.get(encode(["session_part", row.message_id, row.ordinal.toString()])) ?? row.data })),
        events: state.events.map(row => ({ ...row, data: originals.get(encode(["event", row.id])) ?? row.data })),
      }
      requireSafe(encode(plan(db, original)) === encode(changes), "Backup is not a narrow reasoning cleanup")
    }
    db.exec("COMMIT")
    transaction = false
    if (changes.length) {
      // Work may have been admitted while planning. Never interrupt
      // again: acquire the short writer lock, repeat every guard, then compare.
      db.exec("BEGIN IMMEDIATE")
      transaction = true
      verifySchema(db)
      const current = snapshot(db, request.sessionID)
      guard(db, request, current, directory)
      requireSafe(digest(current) === digest(state), "Session changed during cleanup")
      for (const c of changes) {
        const restoring = request.operation === "restore"
        const data = restoring ? c.original : c.cleaned
        const preimage = restoring ? c.cleaned : c.original
        const updated = c.table === "session_part"
          ? db.query("UPDATE session_part SET data = ? WHERE message_id = ? AND ordinal = ? AND session_id = ? AND data = ?").run(data, c.messageID, BigInt(c.ordinal), request.sessionID, preimage)
          : db.query(`UPDATE ${c.table} SET data = ? WHERE id = ? AND ${c.table === "event" ? "aggregate_id" : "session_id"} = ? AND data = ?`).run(data, c.id, request.sessionID, preimage)
        requireSafe(updated.changes === 1, "Concurrent row change; transaction rolled back")
      }
      db.exec("COMMIT")
      transaction = false
    }
    return { ok: true, changedMessages: new Set(changes.flatMap(c => c.table === "session_part" ? [c.messageID] : c.table === "session_message" ? [c.id] : [])).size, changedEvents: changes.filter(c => c.table === "event").length, removedFields: changes.reduce((n, c) => n + c.removedFields, 0) }
  } catch (error) {
    // SQLite/filesystem/JSON errors may contain history or paths: never echo them.
    return { ok: false, error: error instanceof Refusal ? error.message : "Cleanup failed: database or filesystem operation unavailable" }
  } finally {
    if (transaction) { try { db?.exec("ROLLBACK") } catch {} }
    db?.close()
  }
}

if (import.meta.main) {
  let result: Result
  try {
    requireSafe(process.argv.length === 2, "Command-line arguments are not accepted; use one JSON request on stdin")
    result = runCleanup(JSON.parse(await Bun.stdin.text()))
  } catch (error) { result = { ok: false, error: error instanceof Refusal ? error.message : "Invalid JSON request" } }
  process.stdout.write(JSON.stringify(result) + "\n")
  if (!result.ok) process.exitCode = 1
}
