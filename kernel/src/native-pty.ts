// Built into packages/core/src/plugin/qol. The official daemon owns all output,
// child lifetimes and timeout deadlines; this plugin owns only subscriptions.
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { PersistentPty as PtySchema } from "@opencode/schema/persistent-pty"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { Pty } from "@opencode/schema/pty"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Schema, Scope, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { PersistentPty } from "../../persistent-pty.js"
import { Session } from "../../session.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { shellParserWasm } from "#shell-parser-wasm"
import { compilePattern, transcript, unescapeInput } from "./native-pty/transcript.js"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const Dimension = PositiveInt.check(Schema.isLessThanOrEqualTo(65535))
const TargetInput = Schema.Struct({ id: Pty.ID })
const TargetOutput = Schema.Struct({ id: Pty.ID })
const SpawnInput = Schema.Struct({
  command: Schema.String,
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  description: Schema.String,
  workdir: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  notifyOnExit: Schema.optionalKey(Schema.Boolean),
  timeoutSeconds: Schema.optionalKey(PositiveInt),
  cols: Schema.optionalKey(Dimension),
  rows: Schema.optionalKey(Dimension),
})
const ReadInput = Schema.Struct({
  id: Pty.ID,
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optionalKey(PositiveInt),
  pattern: Schema.optionalKey(Schema.String),
  ignoreCase: Schema.optionalKey(Schema.Boolean),
})

function toolError(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error
  return new ToolFailure({ message: error instanceof Error ? error.message : "Native PTY operation failed", error })
}
const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`
const display = (info: PersistentPty.Info) => ({ ...info, status: info.killed ? "killed" : info.status })

export const Plugin = {
  id: "opencode.qol.native-pty",
  effect: Effect.fn("NativePty.Plugin")(function* (ctx: Context) {
    const pty = yield* PersistentPty.Service
    const permission = yield* Permission.Service
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const config = yield* Config.Service
    const shellSelect = yield* ShellSelect.Service
    const shell = yield* shellSelect.resolve({ priority: "compat" })
    const runtime = yield* Effect.context()
    const runFork = Effect.runForkWith(runtime)
    const watching = new Set<Pty.ID>()
    const deleted = new Set<string>()
    const suppressed = new Set<Pty.ID>()
    const assert = (action: string, resources: string[], metadata: Readonly<Record<string, unknown>>, context: Tool.Context) =>
      permission.assert({ action, resources, save: ["*"], metadata, sessionID: context.sessionID,
        agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } })
    const owned = (id: Pty.ID, context: Tool.Context) => Effect.gen(function* () {
      const session = yield* sessions.get(context.sessionID)
      const info = yield* pty.get(id)
      if (session.projectID !== location.project.id || info.sessionID !== context.sessionID)
        return yield* Effect.fail(new Error("PTY belongs to another session or project; access denied"))
      return info
    })
    // Reuse the native shell scanner, external-directory authorization and
    // resource/save rules. No bespoke command parser or permission namespace.
    const authorizeShell = (command: string, cwd: string, context: Tool.Context) => Effect.gen(function* () {
      const target = yield* access.resolve({ path: cwd, kind: "directory" })
      const portable = Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner ??
        (shellParserWasm.bash === "" || ctx.app.channel === "local" || ctx.app.channel === "dev")
      const parsed = yield* ShellParse.scan(command, shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({ path: FileAccess.resolvePath(target.absolute, directory), kind: "directory" }))
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length) yield* permission.assert({ action: "shell",
        resources: parsed.commands.map((c) => c.resource), save: parsed.commands.map((c) => c.save),
        sessionID: context.sessionID, agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id } })
      const kind = yield* Environment.typeFollowing(environment.files, target.absolute)
      if (kind !== "directory") return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return target.absolute
    })
    const complete = (id: Pty.ID) => Effect.gen(function* () {
      if (suppressed.has(id)) return
      const info = yield* pty.get(id)
      if (deleted.has(info.sessionID) || info.tool?.notifyOnExit !== true || typeof info.tool.completionID !== "string") return
      yield* sessions.get(info.sessionID) // Deleted parents are never recreated.
      yield* sessions.synthetic({ sessionID: info.sessionID, id: SessionMessage.ID.make(info.tool.completionID),
        description: String(info.tool.description ?? info.title),
        text: `PTY ${id} (${info.title}) finished: ${JSON.stringify(display(info))}. Read retained output with pty_read.`,
        metadata: { source: "pty", ptyID: id, state: info.killed ? "killed" : "exited" } })
    }).pipe(Effect.catchTags({
      "Session.SyntheticConflictError": () => Effect.void,
    }), Effect.ignore)
    const watch = (info: PersistentPty.Info) => Effect.gen(function* () {
      if (watching.has(info.id) || info.tool?.retainOnExit !== true || info.tool.projectID !== location.project.id) return
      watching.add(info.id)
      yield* Effect.gen(function* () {
        while (!deleted.has(info.sessionID) && !suppressed.has(info.id)) {
          const ended = yield* Deferred.make<boolean>()
          const attachment = yield* pty.attach(info.id, { cursor: info.output.tail,
            attachmentID: `qol-observer-${crypto.randomUUID()}`, role: "observer",
            onEvent: (event) => { if (event.type === "exited") runFork(Deferred.succeed(ended, true)) },
            onEnd: () => { runFork(Deferred.succeed(ended, false)) },
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!attachment) {
            const exists = yield* pty.get(info.id).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!exists) return
            yield* Effect.sleep(1000) // Subscription reconnect, never output polling.
            continue
          }
          attachment.activate()
          const exited = yield* Deferred.await(ended).pipe(Effect.ensuring(Effect.sync(attachment.detach)))
          if (exited) { yield* complete(info.id); return }
        }
      }).pipe(Effect.ensuring(Effect.sync(() => watching.delete(info.id))), Effect.forkIn(scope, { startImmediately: true }))
    })
    const recover = Effect.gen(function* () {
      for (const info of yield* pty.list()) yield* watch(info)
    }).pipe(Effect.ignore)
    yield* bus.subscribe(SessionEvent.Deleted).pipe(Stream.runForEach((event) => Effect.gen(function* () {
      deleted.add(event.data.sessionID)
      for (const info of yield* pty.list(event.data.sessionID)) {
        if (info.tool?.retainOnExit !== true || info.tool.projectID !== location.project.id) continue
        suppressed.add(info.id)
        yield* pty.stop(info.id).pipe(Effect.ignore)
        yield* pty.remove(info.id).pipe(Effect.ignore)
      }
    }).pipe(Effect.ignore)), Effect.forkIn(scope, { startImmediately: true }))
    yield* recover
    yield* ctx.session.hook("context", () => recover)

    yield* ctx.tool.transform((editor) => {
      editor.add({ name: "pty_spawn", description: "Spawn an interactive native PTY. Defaults: current location, 80x24, xterm-256color. Output is retained in the native bounded replay after exit. notifyOnExit wakes this session automatically; do not poll for completion.",
        input: SpawnInput, output: PtySchema.Info,
        execute: (input, context) => Effect.gen(function* () {
          const session = yield* sessions.get(context.sessionID)
          if (session.projectID !== location.project.id) return yield* Effect.fail(new Error("Session belongs to another project; access denied"))
          if (input.workdir !== undefined && input.cwd !== undefined && path.resolve(location.directory, input.workdir) !== path.resolve(location.directory, input.cwd))
            return yield* Effect.fail(new Error("Conflicting workdir and cwd"))
          const args = input.args ?? []
          const cwd = yield* authorizeShell([input.command, ...args].map(quote).join(" "), path.resolve(location.directory, input.workdir ?? input.cwd ?? "."), context)
          const info = yield* pty.create(context.sessionID, { command: input.command, args, cwd,
            title: input.title ?? [input.command, ...args].join(" "), env: input.env ?? {}, cols: input.cols ?? 80, rows: input.rows ?? 24,
            tool: { retainOnExit: true, notifyOnExit: input.notifyOnExit ?? false, completionID: SessionMessage.ID.create(),
              description: input.description, agent: context.agent, projectID: session.projectID,
              ...(input.timeoutSeconds ? { deadline: Date.now() + input.timeoutSeconds * 1000, timeoutSeconds: input.timeoutSeconds } : {}) } })
          yield* watch(info)
          return { output: info, content: JSON.stringify(display(info)) }
        }).pipe(Effect.mapError(toolError)) })
      editor.add({ name: "pty_write", description: "Write terminal input, decoding literal \\n \\r \\t \\xNN \\uNNNN and \\\\. Supports control bytes. Does not take over a pane controller; exited terminals reject writes.",
        input: Schema.Struct({ id: Pty.ID, data: Schema.String }), output: TargetOutput,
        execute: (input, context) => Effect.gen(function* () {
          const info = yield* owned(input.id, context)
          if (info.status !== "running") return yield* Effect.fail(new Error("Cannot write to an exited PTY"))
          const data = unescapeInput(input.data)
          yield* authorizeShell(data, info.cwd, context)
          yield* pty.write(input.id, data)
          return { output: { id: input.id }, content: `Wrote input to ${input.id}` }
        }).pipe(Effect.mapError(toolError)) })
      editor.add({ name: "pty_read", description: "Read the daemon's retained raw output, not just the screen. offset defaults 0, limit 500. Regex filtering precedes match pagination; line numbers refer to the current retained window. Native cropping can shift offsets. Lines are capped at 2000 characters. No extra output store.",
        input: ReadInput, output: Schema.Unknown,
        execute: (input, context) => Effect.gen(function* () {
          const info = yield* owned(input.id, context)
          yield* assert("pty_read", [input.id], input, context)
          yield* Effect.try({ try: () => compilePattern(input.pattern, input.ignoreCase), catch: (error) => error })
          const replay = yield* pty.replay(input.id, 0)
          const result = yield* Effect.try({ try: () => transcript(replay, input), catch: (error) => error })
          return { output: { info: display(info), ...result }, content: `Status: ${info.killed ? "killed" : info.status}\n${result.text}` }
        }).pipe(Effect.mapError(toolError)) })
      editor.add({ name: "pty_list", description: "List native PTYs owned by this session/project, including running/exited/killed status, PID, creation time, exit code/signal, timeout and terminationError. A failed timeout kill remains running with a visible error; retry with pty_kill. Exited output is retained in the bounded native replay.",
        input: Schema.Struct({}), output: Schema.Unknown,
        execute: (input, context) => Effect.gen(function* () {
          const session = yield* sessions.get(context.sessionID)
          if (session.projectID !== location.project.id) return yield* Effect.fail(new Error("Session belongs to another project; access denied"))
          yield* assert("pty_list", [context.sessionID], input, context)
          const terminals = (yield* pty.list(context.sessionID)).map(display)
          return { output: terminals, content: terminals.length ? JSON.stringify(terminals) : "No PTY sessions." }
        }).pipe(Effect.mapError(toolError)) })
      editor.add({ name: "pty_kill", description: "Stop a native PTY and wait for child exit plus final output drainage. cleanup defaults false, preserving the record and output. cleanup=true removes the settled terminal and suppresses completion notification.",
        input: Schema.Struct({ id: Pty.ID, cleanup: Schema.optionalKey(Schema.Boolean) }), output: TargetOutput,
        execute: (input, context) => Effect.gen(function* () {
          yield* owned(input.id, context)
          yield* assert("pty_kill", [input.id], input, context)
          if (input.cleanup) suppressed.add(input.id)
          yield* pty.stop(input.id)
          if (input.cleanup) yield* pty.remove(input.id)
          return { output: { id: input.id }, content: input.cleanup ? `Stopped and removed ${input.id}` : `Stopped ${input.id}; record and output retained` }
        }).pipe(Effect.mapError(toolError)) })
      editor.add({ name: "pty_resize", description: "Resize a native PTY without taking over another controller.",
        input: Schema.Struct({ id: Pty.ID, cols: Dimension, rows: Dimension }), output: TargetOutput,
        execute: (input, context) => Effect.gen(function* () {
          yield* owned(input.id, context)
          yield* assert("pty_resize", [input.id], input, context)
          yield* pty.resize(input.id, input.cols, input.rows)
          return { output: { id: input.id }, content: `Resized ${input.id} to ${input.cols}x${input.rows}` }
        }).pipe(Effect.mapError(toolError)) })
    }).pipe(Effect.orDie)
  }),
}
