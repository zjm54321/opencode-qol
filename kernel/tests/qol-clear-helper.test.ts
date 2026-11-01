import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCleanup, type Request } from "../plugins/clear-encrypted/src/helper.ts";

// Independently transcribed from core/src/database/schema.gen.ts at OpenCode
// 2.2.5, revision 9bbb8ce18c80f099e0e448775f59d965ead40a21. Never derive these
// fixtures from the helper's schema signatures. Only disposable SQLite files
// beneath /tmp/opencode are opened by these tests.
const projectSQL = `CREATE TABLE project (
  id text PRIMARY KEY, worktree text NOT NULL, vcs text, name text, icon_url text,
  icon_url_override text, icon_color text, time_created integer NOT NULL,
  time_updated integer NOT NULL, time_initialized integer, time_active integer DEFAULT 0 NOT NULL,
  time_archived integer, sandboxes text NOT NULL, commands text
);`;
const sessionSQL = `CREATE TABLE session_v2 (
  id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text,
  fork_session_id text, fork_boundary text, slug text NOT NULL, directory text NOT NULL,
  path text, title text, version text NOT NULL, share_url text, summary_additions integer,
  summary_deletions integer, summary_files integer, summary_diffs text, metadata text,
  cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL,
  tokens_output integer DEFAULT 0 NOT NULL, tokens_reasoning integer DEFAULT 0 NOT NULL,
  tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL,
  revert text, permission text, agent text, model text, time_created integer NOT NULL,
  time_updated integer NOT NULL, time_busy integer, time_idle integer, time_viewed integer,
  idle_outcome text, time_compacting integer, time_archived integer, time_suspended integer,
  resume_attempts integer DEFAULT 0 NOT NULL,
  CONSTRAINT fk_session_v2_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);`;
const messageSQL = `CREATE TABLE session_message (
  id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
  time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL,
  CONSTRAINT fk_session_message_session_id_session_v2_id_fk FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);`;
const partSQL = `CREATE TABLE session_part (
  message_id text NOT NULL, session_id text NOT NULL, ordinal integer NOT NULL,
  type text NOT NULL, call_id text, time_created integer NOT NULL, time_updated integer NOT NULL,
  data text NOT NULL, CONSTRAINT session_part_pk PRIMARY KEY(message_id, ordinal),
  CONSTRAINT fk_session_part_message_id_session_message_id_fk FOREIGN KEY (message_id) REFERENCES session_message(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_part_session_id_session_v2_id_fk FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
CREATE INDEX session_part_session_message_idx ON session_part (session_id, message_id, ordinal);`;
const inboxSQL = `CREATE TABLE session_inbox (
  id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, payload text NOT NULL,
  delivery text NOT NULL, enqueued_seq integer NOT NULL, time_created integer NOT NULL,
  CONSTRAINT fk_session_inbox_session_id_session_v2_id_fk FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
CREATE INDEX session_inbox_session_delivery_seq_idx ON session_inbox (session_id, delivery, enqueued_seq);
CREATE UNIQUE INDEX session_inbox_session_enqueued_seq_idx ON session_inbox (session_id, enqueued_seq);`;
const eventSQL = `CREATE TABLE event_sequence (
  aggregate_id text PRIMARY KEY, seq integer NOT NULL, owner_id text
);
CREATE TABLE event (
  id text PRIMARY KEY, aggregate_id text NOT NULL, seq integer NOT NULL,
  created integer DEFAULT 0 NOT NULL, type text NOT NULL, data text NOT NULL,
  CONSTRAINT fk_event_aggregate_id_event_sequence_aggregate_id_fk FOREIGN KEY (aggregate_id) REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX event_aggregate_seq_idx ON event (aggregate_id, seq);
CREATE INDEX event_aggregate_type_seq_idx ON event (aggregate_id, type, seq);`;
// Verbatim statements from the last three relevant pinned migrations. The
// migrated fixture adds time_busy at the end instead of its fresh-schema position.
const dropPendingSQL = `DROP INDEX IF EXISTS session_pending_session_delivery_seq_idx;
DROP INDEX IF EXISTS session_pending_session_compaction_idx;
DROP INDEX IF EXISTS session_pending_session_admitted_seq_idx;
DROP TABLE IF EXISTS session_pending;`;
const sessionID = "ses_fixture";
const raw = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
const encode = (value: unknown) => JSON.stringify(value, (_, value) => typeof value === "bigint" ? { sqliteInteger: value.toString() } : value);
const digest = (value: unknown) => createHash("sha256").update(encode(value)).digest("hex");
type StoredRow = { data: string; [key: string]: any };
const fixtures: Fixture[] = [];
const mocks: { mockRestore(): void }[] = [];

class Fixture {
  root = mkdtempSync("/tmp/opencode/qol-clear-225-");
  directory = join(this.root, "workspace");
  dbPath = join(this.root, "fixture.sqlite");
  db: Database;
  messageSeq = 0;
  eventSeq = 0;

  constructor(mode: "fresh" | "migrated" = "fresh") {
    mkdirSync(this.directory, { mode: 0o700 });
    this.db = new Database(this.dbPath, { create: true, strict: true, safeIntegers: true });
    this.db.exec(projectSQL + (mode === "fresh" ? sessionSQL : sessionSQL.replace("time_busy integer, ", "")) + messageSQL + inboxSQL + eventSQL);
    if (mode === "migrated") {
      this.db.exec("CREATE TABLE session_pending (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, data text NOT NULL, delivery text, admitted_seq integer NOT NULL, time_created integer NOT NULL)");
      this.db.exec(dropPendingSQL);
      this.db.exec(partSQL); // 20261029002625_session_part
      this.db.exec("ALTER TABLE session_v2 ADD time_busy integer;"); // 20261029073502_session_time_busy
    } else this.db.exec(partSQL);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.db.query("INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, ?)").run("prj_fixture", this.directory, 1n, 2n, "[]");
    this.session(sessionID);
    fixtures.push(this);
  }

  session(id: string) {
    this.db.query("INSERT INTO session_v2 (id, project_id, slug, directory, version, time_created, time_updated, time_idle, idle_outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, "prj_fixture", id, this.directory, "2.2.5", 1n, 2n, 10n, "succeeded");
    this.db.query("INSERT INTO event_sequence VALUES (?, ?, NULL)").run(id, 0n);
  }

  message(id: string, type: string, data: unknown, owner = sessionID) {
    this.db.query("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, owner, type, BigInt(++this.messageSeq), 1n, 2n, raw(data));
  }

  assistant(id = "msg_main", content: unknown[] = [], extra: Record<string, unknown> = {}) {
    this.message(id, "assistant", { content, time: { created: 1, completed: 2 }, ...extra });
  }

  part(messageID: string, ordinal: bigint, data: unknown, type?: string, owner = sessionID) {
    const part = typeof data === "string" ? JSON.parse(data) : data as { type: string; id?: string };
    this.db.query("INSERT INTO session_part VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(messageID, owner, ordinal, type ?? part.type, part.type === "tool" ? part.id ?? null : null, 3n, 4n, raw(data));
  }

  event(id: string, type: string, data: Record<string, unknown> | string) {
    this.db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?, ?)").run(id, sessionID, BigInt(++this.eventSeq), 5n, type, typeof data === "string" ? data : raw({ sessionID, ...data }));
    this.db.query("UPDATE event_sequence SET seq = ? WHERE aggregate_id = ?").run(BigInt(this.eventSeq), sessionID);
  }

  request(extra: Partial<Request> = {}): Request {
    return { operation: "clear", dbPath: this.dbPath, sessionID, directory: this.directory, ...extra };
  }

  clear(extra: Partial<Request> = {}) { return runCleanup(this.request(extra)); }
  messageData(id = "msg_main") { return (this.db.query("SELECT data FROM session_message WHERE id = ?").get(id) as StoredRow).data; }
  partData(messageID = "msg_main", ordinal = 0n) { return (this.db.query("SELECT data FROM session_part WHERE message_id = ? AND ordinal = ?").get(messageID, ordinal) as StoredRow).data; }
  eventData(id: string) { return (this.db.query("SELECT data FROM event WHERE id = ?").get(id) as StoredRow).data; }

  snapshot() {
    return {
      session: this.db.query("SELECT * FROM session_v2 WHERE id = ?").get(sessionID),
      sequence: this.db.query("SELECT * FROM event_sequence WHERE aggregate_id = ?").get(sessionID),
      messages: this.db.query("SELECT * FROM session_message WHERE session_id = ? ORDER BY seq, id").all(sessionID) as StoredRow[],
      parts: this.db.query("SELECT * FROM session_part WHERE session_id = ? OR message_id IN (SELECT id FROM session_message WHERE session_id = ?) ORDER BY message_id, ordinal").all(sessionID, sessionID) as StoredRow[],
      events: this.db.query("SELECT * FROM event WHERE aggregate_id = ? ORDER BY seq, id").all(sessionID) as StoredRow[],
    };
  }

  rows() {
    const tables = ["project", "session_v2", "session_message", "session_part", "session_inbox", "event_sequence", "event"];
    return Object.fromEntries(tables.filter(table => this.db.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)).map(table => [table, this.db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  }
}

afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function refused(f: Fixture, error: string, extra: Partial<Request> = {}) {
  const before = f.rows();
  expect(f.clear(extra)).toEqual({ ok: false, error });
  expect(f.rows()).toEqual(before);
}

const reasoning = (key: "state" | "native", value: Record<string, unknown>) => ({ type: "reasoning", text: "thinking", [key]: value });
const encrypted = { reasoningEncryptedContent: "ciphertext", itemId: "reasoning-id" };
function seed(mode: "fresh" | "migrated" = "fresh") {
  const f = new Fixture(mode);
  f.assistant("msg_main", [reasoning("native", encrypted)]);
  return f;
}

// Inject only at the read-snapshot COMMIT, after SQLite releases the read lock.
// The callback uses a real second SQLite connection, never a production hook.
function afterPlanning(f: Fixture, edit: (db: Database) => void) {
  const exec = Database.prototype.exec;
  let edited = false;
  let after: ReturnType<Fixture["rows"]> | undefined;
  const hook = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    const result = exec.call(this, sql);
    if (!edited && this !== f.db && sql === "COMMIT") {
      edited = true;
      const other = new Database(f.dbPath, { create: false, strict: true, safeIntegers: true });
      try { edit(other); } finally { other.close(); }
      after = f.rows();
    }
    return result;
  });
  mocks.push(hook);
  return () => { expect(edited).toBe(true); expect(f.rows()).toEqual(after); };
}

function fieldCount(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce((sum, [key, child]) => sum + (key === "reasoningEncryptedContent" || key === "itemId" ? 1 : 0) + fieldCount(child), 0);
}

function backup(f: Fixture, original: ReturnType<Fixture["snapshot"]>) {
  const post = f.snapshot();
  const changes: Record<string, any>[] = [];
  for (const [table, before, after] of [
    ["session_message", original.messages, post.messages],
    ["session_part", original.parts, post.parts],
    ["event", original.events, post.events],
  ] as const) {
    for (const row of before) {
      const current = after.find(candidate => table === "session_part" ? candidate.message_id === row.message_id && candidate.ordinal === row.ordinal : candidate.id === row.id)!;
      if (row.data === current.data) continue;
      changes.push({ ...(table === "session_part" ? { table, messageID: row.message_id, ordinal: row.ordinal.toString() } : { table, id: row.id }), original: row.data, cleaned: current.data, removedFields: fieldCount(JSON.parse(row.data)) - fieldCount(JSON.parse(current.data)) });
    }
  }
  const stat = statSync(f.dbPath, { bigint: true });
  const value = {
    version: 2,
    identity: { dbPath: f.dbPath, directory: f.directory, sessionID, device: stat.dev.toString(), inode: stat.ino.toString() },
    watermark: encode(post.sequence), postDigest: digest(post), changes,
  };
  const directory = join(f.root, "manual-restore");
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, "format-2.json");
  const save = () => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  save();
  return { value, path, directory, save, restore: () => f.clear({ operation: "restore", backupPath: path }) };
}

describe("clear helper: OpenCode 2.2.5 disposable persistence", () => {
  test.each(["fresh", "migrated"] as const)("accepts independently generated %s schema and creates no backup", mode => {
    const f = seed(mode);
    const files = readdirSync(f.root);
    const missingBackupDir = join(f.root, "must-not-be-created");
    expect(f.clear({ backupDir: missingBackupDir })).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 2 });
    expect(JSON.parse(f.messageData()).content).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(readdirSync(f.root)).toEqual(files);
    expect(existsSync(missingBackupDir)).toBe(false);
    const before = f.rows();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 0, changedEvents: 0, removedFields: 0 });
    expect(f.rows()).toEqual(before);
  });

  test.each(["state", "native"] as const)("clears split reasoning %s and preserves integer tokens, ordinals, and non-data columns", key => {
    const f = new Fixture();
    f.assistant();
    const ordinal = 9007199254740993n;
    f.part("msg_main", ordinal, `{"type":"reasoning","text":"thinking","${key}":{"reasoningEncryptedContent":"ciphertext","itemId":"reasoning-id","signature":"keep","large":9007199254740993},"metadata":{"unrelated":9223372036854775807}}`);
    const before = f.snapshot();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 2 });
    expect(f.partData("msg_main", ordinal)).toBe(`{"type":"reasoning","text":"thinking","${key}":{"signature":"keep","large":9007199254740993},"metadata":{"unrelated":9223372036854775807}}`);
    const post = f.snapshot();
    expect(post.messages).toEqual(before.messages);
    expect(post.session).toEqual(before.session);
    expect(post.sequence).toEqual(before.sequence);
    expect(post.parts.map(({ data, ...row }) => row)).toEqual(before.parts.map(({ data, ...row }) => row));
  });

  test("mixed envelopes, parts, and events correlate by message owner, never by ordinal", () => {
    const f = new Fixture();
    f.assistant("msg_main", [reasoning("state", { itemId: "reasoning-id", keep: "inline" }), reasoning("native", { itemId: "unrelated-id" })]);
    f.part("msg_main", 0n, reasoning("native", encrypted));
    f.part("msg_main", 10n, reasoning("state", { itemId: "reasoning-id", keep: "split" }));
    f.event("evt_start", "session.reasoning.started.1", { assistantMessageID: "msg_main", ordinal: 77, native: { itemId: "reasoning-id" } });
    f.event("evt_end", "session.reasoning.ended.1", { assistantMessageID: "msg_main", ordinal: 88, state: { itemId: "reasoning-id" }, text: "thinking" });
    f.event("evt_update", "session.message.content.updated.1", { messageID: "msg_main", content: [reasoning("native", { itemId: "reasoning-id" })] });
    f.assistant("msg_other", [reasoning("native", { itemId: "reasoning-id" })]);
    f.part("msg_other", 0n, reasoning("state", { itemId: "reasoning-id" }));
    f.event("evt_other", "session.reasoning.started.1", { assistantMessageID: "msg_other", ordinal: 0, state: { itemId: "reasoning-id" } });
    const unrelated = [f.messageData("msg_other"), f.partData("msg_other"), f.eventData("evt_other")];
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 3, removedFields: 7 });
    expect(JSON.parse(f.messageData()).content).toEqual([reasoning("state", { keep: "inline" }), reasoning("native", { itemId: "unrelated-id" })]);
    expect(JSON.parse(f.partData())).toEqual({ type: "reasoning", text: "thinking" });
    expect(JSON.parse(f.partData("msg_main", 10n))).toEqual(reasoning("state", { keep: "split" }));
    expect([f.messageData("msg_other"), f.partData("msg_other"), f.eventData("evt_other")]).toEqual(unrelated);
  });

  test.each(["state", "native"] as const)("clears both reasoning event boundaries and content-updated %s", key => {
    const f = new Fixture();
    f.assistant();
    for (const boundary of ["started", "ended"]) f.event(`evt_${boundary}`, `session.reasoning.${boundary}.1`, { assistantMessageID: "msg_main", ordinal: 0, [key]: { ...encrypted, signature: "preserve" }, text: "full reasoning" });
    f.event("evt_update", "session.message.content.updated.1", { messageID: "msg_main", content: [reasoning(key, { ...encrypted, signature: "preserve" })] });
    expect(f.clear()).toEqual({ ok: true, changedMessages: 0, changedEvents: 3, removedFields: 6 });
    for (const boundary of ["started", "ended"]) expect(JSON.parse(f.eventData(`evt_${boundary}`))[key]).toEqual({ signature: "preserve" });
    expect(JSON.parse(f.eventData("evt_update")).content).toEqual([reasoning(key, { signature: "preserve" })]);
  });

  test("preserves unrelated reasoning-event metadata, including example duplicate keys", () => {
    const f = new Fixture();
    f.assistant();
    f.event("evt_main", "session.reasoning.ended.1", `{"sessionID":"${sessionID}","assistantMessageID":"msg_main","native":{"reasoningEncryptedContent":"ciphertext","itemId":"reasoning-id","signature":"keep"},"metadata":{"reasoningEncryptedContent":"example","itemId":"unrelated","x":1,"x":2},"ordinal":0}`);
    expect(f.clear()).toEqual({ ok: true, changedMessages: 0, changedEvents: 1, removedFields: 2 });
    expect(f.eventData("evt_main")).toBe(`{"sessionID":"${sessionID}","assistantMessageID":"msg_main","native":{"signature":"keep"},"metadata":{"reasoningEncryptedContent":"example","itemId":"unrelated","x":1,"x":2},"ordinal":0}`);
  });

  test("preserves unrelated JSON integer tokens and every non-data column across all changed tables", () => {
    const f = new Fixture();
    const native = '"native":{"reasoningEncryptedContent":"ciphertext","itemId":"reasoning-id","large":9007199254740993}';
    f.message("msg_main", "assistant", `{"time":{"created":1,"completed":2},"content":[{"type":"reasoning","text":"thinking",${native}}],"unknown":{"large":9223372036854775807}}`);
    f.part("msg_main", 9007199254740993n, `{"type":"reasoning","text":"thinking",${native}}`);
    f.event("evt_main", "session.reasoning.ended.1", `{"sessionID":"${sessionID}","assistantMessageID":"msg_main","ordinal":9007199254740993,${native}}`);
    f.db.exec("UPDATE session_message SET seq = 9007199254740993, time_updated = 9223372036854775807; UPDATE event SET seq = 9007199254740993, created = 9223372036854775807; UPDATE event_sequence SET seq = 9007199254740993;");
    const before = f.snapshot();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 1, removedFields: 6 });
    const post = f.snapshot();
    expect(post.session).toEqual(before.session);
    expect(post.sequence).toEqual(before.sequence);
    for (const table of ["messages", "parts", "events"] as const) {
      expect(post[table].map(({ data, ...row }) => row)).toEqual(before[table].map(({ data, ...row }) => row));
      for (const row of post[table]) expect(row.data).toContain('"large":9007199254740993');
    }
    expect(f.messageData()).toContain('"unknown":{"large":9223372036854775807}');
    expect(f.eventData("evt_main")).toContain('"ordinal":9007199254740993');
  });

  test.each([null, ""])("clears a present null/empty encrypted value and its paired item identity", value => {
    const f = new Fixture();
    f.assistant("msg_main", [reasoning("native", { reasoningEncryptedContent: value, itemId: "reasoning-id" })]);
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 2 });
    expect(JSON.parse(f.messageData()).content).toEqual([{ type: "reasoning", text: "thinking" }]);
  });

  test("legacy and current native fields coexist and preserve all unrelated history", () => {
    const f = new Fixture();
    const example = '{"example":{"x":1,"x":2},"reasoningEncryptedContent":"quoted example","itemId":"user-id","text":"verbatim"}';
    f.message("msg_user", "user", example);
    const tool = { type: "tool", id: "call-preserve", name: "tool", state: { status: "completed", input: { ...encrypted }, content: [{ type: "text", text: "result" }] }, native: { ...encrypted }, time: { created: 1, completed: 2 } };
    f.assistant("msg_main", [
      { type: "reasoning", text: "thinking", state: { ...encrypted, signature: "legacy", unknown: { preserve: true } }, native: { ...encrypted, signature: "current" } },
      { type: "text", text: "answer", native: { ...encrypted } }, tool,
    ], { native: { checkpoint: "encrypted checkpoint", ...encrypted }, metadata: { ...encrypted } });
    f.part("msg_main", 0n, tool);
    f.part("msg_main", 1n, { type: "text", text: "part answer", native: { ...encrypted } });
    for (const type of ["session.text.ended.1", "session.tool.called.1", "session.step.ended.1"]) f.event(`evt_${type}`, type, { assistantMessageID: "msg_main", native: { ...encrypted }, state: { ...encrypted } });
    const before = f.snapshot();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 4 });
    const message = JSON.parse(f.messageData());
    expect(message.content[0]).toEqual({ type: "reasoning", text: "thinking", state: { signature: "legacy", unknown: { preserve: true } }, native: { signature: "current" } });
    expect(message.content.slice(1)).toEqual([{ type: "text", text: "answer", native: { ...encrypted } }, tool]);
    expect(message.native).toEqual({ checkpoint: "encrypted checkpoint", ...encrypted });
    expect(message.metadata).toEqual({ ...encrypted });
    expect(f.messageData("msg_user")).toBe(example);
    expect(f.snapshot().parts).toEqual(before.parts);
    expect(f.snapshot().events).toEqual(before.events);
  });

  test.each(["providerContext", "native"] as const)("clears compaction %s windows in messages and events without touching checkpoints", key => {
    const f = new Fixture();
    const messages = [{ role: "assistant", content: [
      { type: "reasoning", text: "thinking", providerMetadata: { openai: { ...encrypted }, "provider.with-punctuation": { ...encrypted, signature: "keep" } } },
      { type: "text", text: "answer", providerMetadata: { openai: { ...encrypted } } },
    ] }, { role: "user", content: "verbatim user text" }];
    const context = key === "providerContext" ? { version: 1, provenance: { providerID: "openai" }, messages } : { checkpoint: "encrypted_content", reasoningEncryptedContent: "checkpoint-preserved", messages };
    f.message("msg_compaction", "compaction", { status: "completed", summary: "summary", [key]: context });
    f.event("evt_compaction", "session.compaction.ended.1", { summary: "summary", [key]: context });
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 1, removedFields: 8 });
    for (const value of [JSON.parse(f.messageData("msg_compaction")), JSON.parse(f.eventData("evt_compaction"))]) {
      expect(value[key].messages[0].content[0].providerMetadata).toEqual({ "provider.with-punctuation": { signature: "keep" } });
      expect(value[key].messages[0].content[1]).toEqual(messages[0]!.content[1]);
      expect(value[key].messages[1]).toEqual(messages[1]);
      if (key === "native") expect(value.native.reasoningEncryptedContent).toBe("checkpoint-preserved");
      else expect(value.providerContext.provenance).toEqual({ providerID: "openai" });
    }
  });

  test.each(["providerContext", "native"] as const)("%s compaction item correlation is confined to window, message index, namespace, and owning row", key => {
    const f = new Fixture();
    const part = (value: Record<string, unknown>) => ({ type: "reasoning", text: "thinking", providerMetadata: value });
    const window = [
      { role: "assistant", content: [part({ openai: { ...encrypted } }), part({ openai: { itemId: "reasoning-id" }, other: { itemId: "reasoning-id" } })] },
      { role: "assistant", content: [part({ openai: { itemId: "reasoning-id" } })] },
    ];
    const otherKey = key === "native" ? "providerContext" : "native";
    const otherWindow = [{ role: "assistant", content: [part({ openai: { itemId: "reasoning-id" } })] }];
    const context = (name: string, messages: unknown[]) => name === "providerContext" ? { version: 1, messages } : { messages };
    const otherContext = context(otherKey, otherWindow);
    f.message("msg_compaction", "compaction", { status: "completed", [key]: context(key, window), [otherKey]: otherContext });
    f.message("msg_other", "compaction", { status: "completed", [key]: context(key, [window[1]]) });
    f.event("evt_other", "session.compaction.ended.1", { [otherKey]: otherContext });
    const other = [f.messageData("msg_other"), f.eventData("evt_other")];
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 3 });
    const value = JSON.parse(f.messageData("msg_compaction"));
    expect(value[key].messages[0].content[0]).toEqual({ type: "reasoning", text: "thinking" });
    expect(value[key].messages[0].content[1].providerMetadata).toEqual({ other: { itemId: "reasoning-id" } });
    expect(value[key].messages[1]).toEqual(window[1]);
    expect(value[otherKey]).toEqual(otherContext);
    expect([f.messageData("msg_other"), f.eventData("evt_other")]).toEqual(other);
  });
});

describe("clear helper: fail-closed schema, shapes, and identities", () => {
  test.each([
    "ALTER TABLE session_v2 ADD unexpected text",
    "ALTER TABLE session_v2 DROP COLUMN time_busy",
    "CREATE TABLE session_pending (id text)",
    "ALTER TABLE session_part ADD extra integer GENERATED ALWAYS AS (ordinal + 1) VIRTUAL",
    "DROP TABLE session_part",
    "DROP TABLE session_part; CREATE VIEW session_part AS SELECT * FROM session_message",
  ])("refuses schema drift: %s", sql => {
    const f = seed();
    f.db.exec(sql);
    refused(f, "Unsupported database schema");
  });

  test.each([
    partSQL.replace("PRIMARY KEY(message_id, ordinal)", "PRIMARY KEY(ordinal, message_id)"),
    partSQL.replace("ordinal integer NOT NULL", "ordinal integer"),
  ])("refuses incompatible part primary keys/nullability", sql => {
    const f = seed();
    f.db.exec("DROP TABLE session_part");
    f.db.exec(sql);
    refused(f, "Unsupported database schema");
  });

  test("refuses triggers even on unrelated tables", () => {
    const f = seed();
    f.db.exec("CREATE TRIGGER history_side_effect AFTER UPDATE ON project BEGIN UPDATE session_message SET data = '{}'; END");
    refused(f, "Database triggers are unsupported");
  });

  test.each([
    '{"type":"reasoning","text":"thinking","native":{"reasoningEncryptedContent":"one","reasoningEncryptedContent":"two"}}',
    '{"type":"text","type":"reasoning","text":"thinking","native":{"reasoningEncryptedContent":"ciphertext"}}',
    '{"type":"reasoning","text":"thinking","native":{"itemId":"one","itemId":"two","reasoningEncryptedContent":"ciphertext"}}',
    '{"type":"reasoning","text":"thinking","native":{},"native":{"reasoningEncryptedContent":"ciphertext"}}',
  ])("refuses duplicate split reasoning JSON keys", data => {
    const f = new Fixture();
    f.assistant();
    f.part("msg_main", 0n, data);
    refused(f, "Duplicate reasoning JSON keys are unsupported");
  });

  test("refuses duplicate inline selectors and event owner identities", () => {
    const inline = new Fixture();
    inline.message("msg_main", "assistant", '{"time":{"completed":2},"content":[],"content":[{"type":"reasoning","native":{"reasoningEncryptedContent":"ciphertext"}}]}');
    refused(inline, "Duplicate reasoning JSON keys are unsupported");
    const event = new Fixture();
    event.assistant();
    event.event("evt_main", "session.reasoning.ended.1", `{"sessionID":"${sessionID}","assistantMessageID":"msg_other","assistantMessageID":"msg_main","native":{"reasoningEncryptedContent":"ciphertext"}}`);
    refused(event, "Duplicate reasoning JSON keys are unsupported");
  });

  test.each([
    '{"status":"completed","native":{"messages":[],"messages":[{"content":[{"type":"reasoning","providerMetadata":{"openai":{"reasoningEncryptedContent":"ciphertext"}}}]}]}}',
    '{"status":"completed","native":{"messages":[{"content":[{"type":"reasoning","providerMetadata":{"openai":{"reasoningEncryptedContent":"one"},"openai":{"reasoningEncryptedContent":"two"}}}]}]}}',
  ])("refuses duplicate native compaction selectors", data => {
    const f = new Fixture();
    f.message("msg_compaction", "compaction", data);
    refused(f, "Duplicate reasoning JSON keys are unsupported");
  });

  test.each([
    { type: "reasoning", native: [] },
    { type: "reasoning", state: "invalid" },
    { type: "reasoning", native: { reasoningEncryptedContent: 1 } },
    { type: "reasoning", native: { reasoningEncryptedContent: "ciphertext", itemId: 1 } },
    { type: "reasoning", native: { itemId: 1 } },
    { type: "reasoning", reasoningEncryptedContent: "unknown root" },
    { type: "reasoning", native: { nested: { reasoningEncryptedContent: "unknown nested shape" } } },
  ] as Record<string, any>[])("refuses malformed recognized split targets: %j", data => {
    const f = new Fixture();
    f.assistant();
    f.part("msg_main", 0n, data);
    const error = Array.isArray(data.native) || typeof data.state === "string" ? "Unsupported reasoning state" : "reasoningEncryptedContent" in data || data.native?.nested ? "Unknown encrypted reasoning shape" : typeof data.native?.reasoningEncryptedContent === "number" ? "Unsupported encrypted reasoning value" : "Unsupported reasoning item identity";
    refused(f, error);
  });

  test.each([
    { native: { messages: "invalid" } },
    { providerContext: { version: 2, messages: [] } },
    { native: { messages: [1] } },
    { native: { messages: [{ content: null }] } },
    { native: { messages: [{ content: { type: "reasoning", providerMetadata: { openai: encrypted } } }] } },
    { native: { messages: [{ content: [1] }] } },
    { native: { messages: [{ content: [{ type: "reasoning", providerMetadata: [] }] }] } },
    { native: { messages: [{ content: [{ type: "reasoning", providerMetadata: { openai: "invalid" } }] }] } },
    { native: { messages: [{ content: [{ type: "reasoning", providerMetadata: { 'bad"namespace': { ...encrypted } } }] }] } },
    { native: { messages: [{ content: [{ type: "reasoning", reasoningEncryptedContent: "unknown" }] }] } },
  ])("refuses malformed recognized compaction targets", context => {
    const f = new Fixture();
    f.message("msg_compaction", "compaction", { status: "completed", ...context });
    const before = f.rows();
    expect(f.clear()).toMatchObject({ ok: false });
    expect(f.rows()).toEqual(before);
  });

  test("refuses malformed stored JSON and unknown reasoning event shapes", () => {
    const f = seed();
    f.db.query("UPDATE session_message SET data = ? WHERE id = ?").run("{invalid json", "msg_main");
    refused(f, "Invalid stored JSON");
    const event = new Fixture();
    event.assistant();
    event.event("evt_main", "session.reasoning.started.1", { assistantMessageID: "msg_main", reasoningEncryptedContent: "unknown root" });
    refused(event, "Unknown encrypted reasoning shape");
  });

  test.each(["foreign part session", "foreign message owner", "non-assistant parent", "missing parent", "different type"])("refuses split ownership/type mismatch: %s", mismatch => {
    const f = new Fixture();
    f.assistant();
    f.session("ses_other");
    if (mismatch === "foreign message owner") f.message("msg_other", "assistant", { content: [], time: { completed: 2 } }, "ses_other");
    if (mismatch === "non-assistant parent") f.message("msg_user", "user", { text: "user" });
    if (mismatch === "missing parent") f.db.exec("PRAGMA foreign_keys = OFF");
    const parent = mismatch === "foreign message owner" ? "msg_other" : mismatch === "non-assistant parent" ? "msg_user" : mismatch === "missing parent" ? "msg_missing" : "msg_main";
    f.part(parent, 0n, reasoning("native", encrypted), mismatch === "different type" ? "text" : undefined, mismatch === "foreign part session" ? "ses_other" : sessionID);
    refused(f, mismatch === "different type" ? "Part type mismatch" : "Part message/session identity mismatch");
  });

  test("refuses fractional SQLite part identities instead of rounding an ordinal", () => {
    const f = new Fixture();
    f.assistant();
    f.part("msg_main", 0n, reasoning("native", encrypted));
    f.db.exec("UPDATE session_part SET ordinal = 0.5");
    refused(f, "Unsupported part ordinal");
  });
});

describe("clear helper: durable idle and unfinished-work guards", () => {
  test.each([
    [20n, null], [20n, 10n],
  ])("refuses an unsettled persistent busy timestamp", (busy, idle) => {
    const f = seed();
    f.db.query("UPDATE session_v2 SET time_busy = ?, time_idle = ? WHERE id = ?").run(busy, idle, sessionID);
    refused(f, "Session has active execution or compaction");
  });

  test.each([[10n, 10n], [9n, 10n], [null, null]])("allows a settled/non-busy durable claim", (busy, idle) => {
    const f = seed();
    f.db.query("UPDATE session_v2 SET time_busy = ?, time_idle = ? WHERE id = ?").run(busy, idle, sessionID);
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 2 });
  });

  test.each(["time_suspended", "time_compacting"])("refuses %s", column => {
    const f = seed();
    f.db.query(`UPDATE session_v2 SET ${column} = ? WHERE id = ?`).run(1n, sessionID);
    refused(f, "Session has active execution or compaction");
  });

  test.each(["steer", "queue"])("refuses every inbox delivery, including %s", delivery => {
    const f = seed();
    f.db.query("INSERT INTO session_inbox VALUES (?, ?, ?, ?, ?, ?, ?)").run("msg_inbox", sessionID, "user", '{"text":"queued"}', delivery, 1n, 2n);
    refused(f, "Session has pending or inbox work");
  });

  test.each(["fork_session_id", "fork_boundary", "fork child"])("refuses fork relationships: %s", kind => {
    const f = seed();
    if (kind === "fork child") {
      f.session("ses_child");
      f.db.query("UPDATE session_v2 SET fork_session_id = ? WHERE id = ?").run(sessionID, "ses_child");
    } else f.db.query(`UPDATE session_v2 SET ${kind} = ? WHERE id = ?`).run("fork-reference", sessionID);
    refused(f, "Fork relationships are unsupported");
  });

  test("refuses missing/replicated aggregates, directory mismatch, and ahead-of-watermark events", () => {
    const owned = seed();
    owned.db.query("UPDATE event_sequence SET owner_id = ? WHERE aggregate_id = ?").run("replica", sessionID);
    refused(owned, "Missing or replicated/owned event aggregate");
    const missing = seed();
    missing.db.query("DELETE FROM event_sequence WHERE aggregate_id = ?").run(sessionID);
    refused(missing, "Missing or replicated/owned event aggregate");
    const directory = seed();
    refused(directory, "Session directory mismatch", { directory: directory.root });
    const watermark = seed();
    watermark.event("evt_ahead", "session.reasoning.ended.1", { assistantMessageID: "msg_main", native: encrypted });
    watermark.db.query("UPDATE event_sequence SET seq = ? WHERE aggregate_id = ?").run(0n, sessionID);
    refused(watermark, "Inconsistent event watermark");
    const event = seed();
    event.event("evt_identity", "session.reasoning.ended.1", { sessionID: "ses_other", assistantMessageID: "msg_main", native: encrypted });
    refused(event, "Event session identity mismatch");
  });

  test("refuses unfinished assistants and compactions", () => {
    const assistant = seed();
    assistant.db.query("UPDATE session_message SET data = ? WHERE id = ?").run(raw({ content: [reasoning("native", encrypted)], time: { created: 1 } }), "msg_main");
    refused(assistant, "Session has unfinished assistant work");
    const compaction = seed();
    compaction.message("msg_compaction", "compaction", { status: "running", summary: "in progress" });
    refused(compaction, "Session has unfinished compaction work");
  });

  test.each(["inline", "split"])("refuses all unfinished %s tools", storage => {
    for (const status of ["streaming", "running"]) {
      const f = new Fixture();
      const tool = { type: "tool", id: "call", state: { status, input: {} } };
      f.assistant("msg_main", storage === "inline" ? [reasoning("native", encrypted), tool] : [reasoning("native", encrypted)]);
      if (storage === "split") f.part("msg_main", 0n, tool);
      refused(f, "Session has unfinished tool work");
    }
  });

  test.each(["completed", "error"])("allows terminal inline and split tools: %s", status => {
    const f = new Fixture();
    const tool = { type: "tool", id: "call", state: { status, input: {}, content: [{ type: "text", text: "tool output" }] } };
    f.assistant("msg_main", [reasoning("native", encrypted), tool]);
    f.part("msg_main", 0n, tool);
    const before = f.partData();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 1, changedEvents: 0, removedFields: 2 });
    expect(f.partData()).toBe(before);
  });

  test("refuses running shell messages even when the session claims idle", () => {
    const f = seed();
    f.message("msg_shell", "shell", { shellID: "sh_fixture", command: "sleep", status: "running", time: { created: 1 } });
    refused(f, "Session has unfinished shell work");
  });

  test.each(["exited", "timeout", "killed"])("preserves terminal shell messages: %s", status => {
    const f = seed();
    f.message("msg_shell", "shell", { shellID: "sh_fixture", command: "echo", status, time: { created: 1, completed: 2 }, output: "keep" });
    const before = f.messageData("msg_shell");
    expect(f.clear()).toMatchObject({ ok: true });
    expect(f.messageData("msg_shell")).toBe(before);
  });
});

describe("clear helper: optimistic conflicts and rollback", () => {
  test.each(["insert", "delete", "data", "non-data"])("includes split parts in optimistic conflicts: %s", mutation => {
    const f = new Fixture();
    f.assistant();
    f.part("msg_main", 0n, reasoning("native", encrypted));
    const unchanged = f.partData();
    const checked = afterPlanning(f, db => {
      if (mutation === "insert") db.query("INSERT INTO session_part VALUES (?, ?, ?, ?, NULL, ?, ?, ?)").run("msg_main", sessionID, 10n, "text", 1n, 2n, '{"type":"text","text":"admitted"}');
      if (mutation === "delete") db.query("DELETE FROM session_part WHERE message_id = ? AND ordinal = ?").run("msg_main", 0n);
      if (mutation === "data") db.query("UPDATE session_part SET data = ? WHERE message_id = ? AND ordinal = ?").run(raw(reasoning("native", { ...encrypted, signature: "new" })), "msg_main", 0n);
      if (mutation === "non-data") db.query("UPDATE session_part SET time_updated = ? WHERE message_id = ? AND ordinal = ?").run(9007199254740993n, "msg_main", 0n);
    });
    expect(f.clear()).toEqual({ ok: false, error: "Session changed during cleanup" });
    checked();
    if (mutation === "insert" || mutation === "non-data") expect(f.partData()).toBe(unchanged);
  });

  test.each([
    ["UPDATE session_v2 SET time_busy = 20, time_idle = 10", "Session has active execution or compaction"],
    ["INSERT INTO session_inbox VALUES ('msg_queued', 'ses_fixture', 'user', '{}', 'queue', 1, 2)", "Session has pending or inbox work"],
    ["UPDATE event_sequence SET owner_id = 'replica'", "Missing or replicated/owned event aggregate"],
    ["CREATE TRIGGER newly_admitted AFTER UPDATE ON project BEGIN SELECT 1; END", "Database triggers are unsupported"],
  ])("rechecks guards/schema after planning: %s", (sql, error) => {
    const f = seed();
    const checked = afterPlanning(f, db => db.exec(sql));
    expect(f.clear()).toEqual({ ok: false, error });
    checked();
  });

  test("SQLite failure on a later part write rolls back earlier envelope/part changes", () => {
    const f = seed();
    f.db.exec("DROP TABLE session_part");
    f.db.exec(partSQL.replace("data text NOT NULL", "data text NOT NULL CHECK (instr(data, 'reasoningEncryptedContent') > 0)"));
    f.part("msg_main", 0n, reasoning("native", encrypted));
    const before = f.rows();
    expect(f.clear()).toEqual({ ok: false, error: "Cleanup failed: database or filesystem operation unavailable" });
    expect(f.rows()).toEqual(before);
  });

  test("exact part preimage mismatch rolls back the whole writer transaction", () => {
    const f = seed();
    f.part("msg_main", 0n, reasoning("native", encrypted));
    const before = f.rows();
    const query = Database.prototype.query;
    let removed = false;
    const hook = spyOn(Database.prototype, "query").mockImplementation(function (this: Database, sql: string) {
      const statement = query.call(this, sql);
      if (!removed && this !== f.db && sql.startsWith("UPDATE session_part SET data")) {
        removed = true;
        query.call(this, "DELETE FROM session_part WHERE message_id = 'msg_main' AND ordinal = 0").run();
      }
      return statement;
    });
    mocks.push(hook);
    expect(f.clear()).toEqual({ ok: false, error: "Concurrent row change; transaction rolled back" });
    expect(removed).toBe(true);
    expect(f.rows()).toEqual(before);
  });
});

describe("clear helper: externally supplied format-2 restore safety", () => {
  test("restores exact bytes for envelopes/events/parts, including large composite ordinals", () => {
    const f = seed("migrated");
    f.part("msg_main", 9007199254740993n, reasoning("state", encrypted));
    f.assistant("msg_other");
    f.part("msg_other", 9007199254740993n, reasoning("native", encrypted));
    f.event("evt_main", "session.reasoning.ended.1", { assistantMessageID: "msg_main", ordinal: 10, native: encrypted });
    const rows = f.rows();
    const original = f.snapshot();
    expect(f.clear()).toEqual({ ok: true, changedMessages: 2, changedEvents: 1, removedFields: 8 });
    const file = backup(f, original);
    expect(file.value.changes.filter(change => change.table === "session_part").map(change => change.ordinal)).toEqual(["9007199254740993", "9007199254740993"]);
    expect(file.restore()).toEqual({ ok: true, changedMessages: 2, changedEvents: 1, removedFields: 8 });
    expect(f.rows()).toEqual(rows);
  });

  test("explicitly rejects old-schema version-1 backups", () => {
    const f = seed();
    const original = f.snapshot();
    f.clear();
    const file = backup(f, original);
    file.value.version = 1;
    file.save();
    refused(f, "Unsupported backup version", { operation: "restore", backupPath: file.path });
  });

  test.each(["identity", "watermark", "post-digest", "post-image", "duplicate", "unrelated original", "removed count"])("refuses unsafe format-2 restore: %s", corruption => {
    const f = seed();
    f.part("msg_main", 0n, reasoning("native", encrypted));
    const original = f.snapshot();
    f.clear();
    const file = backup(f, original);
    let error = "Backup is not a narrow reasoning cleanup";
    if (corruption === "identity") { file.value.identity.inode = "wrong"; error = "Backup identity mismatch"; }
    if (corruption === "watermark") { file.value.watermark = "wrong"; error = "Restore conflict: session changed since cleanup"; }
    if (corruption === "post-digest") { file.value.postDigest = "wrong"; error = "Restore conflict: session changed since cleanup"; }
    if (corruption === "post-image") { file.value.changes[1]!.cleaned = "{}"; error = "Restore conflict: post-image changed"; }
    if (corruption === "duplicate") { file.value.changes.push({ ...file.value.changes[1] }); error = "Duplicate backup row"; }
    if (corruption === "unrelated original") file.value.changes[1]!.original = file.value.changes[1]!.original.replace("thinking", "tampered text");
    if (corruption === "removed count") file.value.changes[1]!.removedFields++;
    file.save();
    refused(f, error, { operation: "restore", backupPath: file.path });
  });

  test.each([0, "00", "+0", "-0", "0.0", "1e2", "9223372036854775808", "-9223372036854775809"])("refuses noncanonical/unsafe backup part ordinal: %j", ordinal => {
    const f = new Fixture();
    f.assistant();
    f.part("msg_main", 0n, reasoning("native", encrypted));
    const original = f.snapshot();
    f.clear();
    const file = backup(f, original);
    file.value.changes[0]!.ordinal = ordinal;
    file.save();
    refused(f, "Invalid backup part identity", { operation: "restore", backupPath: file.path });
  });

  test.each(["file mode", "parent mode", "symlink"])("retains private restore-file checks: %s", kind => {
    const f = seed();
    const original = f.snapshot();
    f.clear();
    const file = backup(f, original);
    let path = file.path;
    if (kind === "file mode") chmodSync(path, 0o644);
    if (kind === "parent mode") chmodSync(file.directory, 0o755);
    if (kind === "symlink") { path = join(file.directory, "symlink.json"); symlinkSync(file.path, path); }
    refused(f, "Backup must be private and owned by the current user", { operation: "restore", backupPath: path });
  });

  test("parts participate in restore post-digests and the second-phase conflict check", () => {
    const changed = new Fixture();
    changed.assistant();
    changed.part("msg_main", 0n, reasoning("native", encrypted));
    const before = changed.snapshot();
    changed.clear();
    const file = backup(changed, before);
    changed.part("msg_main", 1n, { type: "text", text: "new history" });
    refused(changed, "Restore conflict: session changed since cleanup", { operation: "restore", backupPath: file.path });

    const raced = new Fixture();
    raced.assistant();
    raced.part("msg_main", 0n, reasoning("native", encrypted));
    const original = raced.snapshot();
    raced.clear();
    const second = backup(raced, original);
    const checked = afterPlanning(raced, db => db.query("DELETE FROM session_part WHERE message_id = ? AND ordinal = ?").run("msg_main", 0n));
    expect(second.restore()).toEqual({ ok: false, error: "Session changed during cleanup" });
    checked();
  });
});
