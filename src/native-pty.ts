// Built into packages/core/src/plugin/qol; uses the host's existing daemon.
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { PersistentPty as PtySchema } from "@opencode/schema/persistent-pty"
import { Pty } from "@opencode/schema/pty"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { PersistentPty } from "../../persistent-pty.js"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const SpawnInput = Schema.Struct({
  command: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  cwd: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  cols: Schema.optionalKey(PositiveInt),
  rows: Schema.optionalKey(PositiveInt),
})
const TargetInput = Schema.Struct({ id: Pty.ID })
const WriteInput = Schema.Struct({ id: Pty.ID, data: Schema.String })
const ScreenOutput = Schema.Struct({
  info: PtySchema.Info,
  screen: Schema.Struct({ text: Schema.String, cursor: PtySchema.Snapshot.fields.cursor }),
})
const TargetOutput = Schema.Struct({ id: Pty.ID })

function toolError(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error
  const message = error instanceof PersistentPty.NotFoundError
    ? `PTY not found: ${error.ptyID}`
    : error instanceof PersistentPty.UnavailableError
      ? `Native PTY unavailable: ${error.message}`
      : error instanceof Error ? error.message : "Native PTY operation failed"
  return new ToolFailure({ message, error })
}

export const Plugin = {
  id: "opencode-qol.native-pty",
  effect: Effect.fn("NativePty.Plugin")(function* (ctx: Context) {
    // These services are captured by PluginInternal.resolve, not assumed to be
    // available through the Promise plugin host or during later tool execution.
    const pty = yield* PersistentPty.Service
    const permission = yield* Permission.Service
    const location = yield* Location.Service
    const assert = (
      action: string,
      resources: string[],
      metadata: Readonly<Record<string, unknown>>,
      context: Tool.Context,
    ) => permission.assert({
      action,
      resources,
      save: ["*"],
      metadata,
      sessionID: context.sessionID,
      agent: context.agent,
      source: { type: "tool", messageID: context.messageID, id: context.id },
    })
    const owned = (id: Pty.ID, context: Tool.Context) => Effect.gen(function* () {
      const info = yield* pty.get(id)
      // The basic agent tools are session-local even if a broad permission rule
      // allows the action. There is no caller-supplied sessionID or takeover.
      if (info.sessionID !== context.sessionID) {
        return yield* Effect.fail(new ToolFailure({ message: "PTY belongs to another session; access denied" }))
      }
      return info
    })

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "pty_spawn",
        description: "Create a persistent terminal using OpenCode's native PTY daemon, owned by the current session. cwd defaults to the current location; command defaults to the native shell. No exit notifications are registered.",
        input: SpawnInput,
        output: PtySchema.Info,
        execute: (input, context) => Effect.gen(function* () {
          const cwd = path.resolve(location.directory, input.cwd ?? ".")
          yield* assert("pty_spawn", [cwd], { ...input, cwd }, context)
          const info = yield* pty.create(context.sessionID, {
            command: input.command,
            args: input.args ?? [],
            cwd,
            title: input.title ?? input.command ?? "Terminal",
            env: input.env ?? {},
            cols: input.cols,
            rows: input.rows,
          })
          return { output: info, content: JSON.stringify(info) }
        }).pipe(Effect.mapError(toolError)),
      })
      editor.add({
        name: "pty_write",
        description: "Write exact terminal input to a native PTY owned by the current session. Include a newline to submit a command. Does not take over another controller attachment.",
        input: WriteInput,
        output: TargetOutput,
        execute: (input, context) => Effect.gen(function* () {
          yield* assert("pty_write", [input.id], input, context)
          yield* owned(input.id, context)
          yield* pty.write(input.id, input.data)
          return { output: { id: input.id }, content: `Wrote input to ${input.id}` }
        }).pipe(Effect.mapError(toolError)),
      })
      editor.add({
        name: "pty_read",
        description: "Read the current screen snapshot of a native PTY owned by the current session. This is NOT a historical transcript or scrollback: there are no offsets, grep filters, polling, or additional output buffers. Reading does not select or take over a terminal.",
        input: TargetInput,
        output: ScreenOutput,
        execute: (input, context) => Effect.gen(function* () {
          yield* assert("pty_read", [input.id], input, context)
          yield* owned(input.id, context)
          const snapshot = yield* pty.snapshot(input.id)
          const output = { info: snapshot.info, screen: { text: snapshot.text, cursor: snapshot.cursor } }
          return { output, content: snapshot.text }
        }).pipe(Effect.mapError(toolError)),
      })
      editor.add({
        name: "pty_list",
        description: "List native persistent terminals owned by the current session only, including native lifecycle status and screen dimensions.",
        input: Schema.Struct({}),
        output: Schema.Array(PtySchema.Info),
        execute: (input, context) => Effect.gen(function* () {
          yield* assert("pty_list", [context.sessionID], input, context)
          const terminals = yield* pty.list(context.sessionID)
          return { output: terminals, content: JSON.stringify(terminals) }
        }).pipe(Effect.mapError(toolError)),
      })
      editor.add({
        name: "pty_kill",
        description: "Terminate and remove a native persistent terminal owned by the current session. Uses the same OpenCode daemon as the built-in terminal UI.",
        input: TargetInput,
        output: TargetOutput,
        execute: (input, context) => Effect.gen(function* () {
          yield* assert("pty_kill", [input.id], input, context)
          yield* owned(input.id, context)
          yield* pty.remove(input.id)
          return { output: { id: input.id }, content: `Terminated ${input.id}` }
        }).pipe(Effect.mapError(toolError)),
      })
    }).pipe(Effect.orDie)
  }),
}
