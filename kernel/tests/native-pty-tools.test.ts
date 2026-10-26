import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import path from "node:path"

// Host-service isolation, not a replacement PTY. Real protocol/runtime tests
// are in native-pty-daemon.test.ts. Point at the official core's dependencies.
const modules = process.env.QOL_NATIVE_CORE_MODULES
describe.skipIf(!modules)("native PTY tools with native Effect and isolated host services", () => {
  let E: any, Plugin: any, services: Record<string, any>, tools: Map<string, any>, scope: any
  let terminals: Map<string, any>, notifications: Map<string, any>, callbacks: Map<string, any>
  let assertions: any[], writes: string[], shellCommands: string[], hook: () => any, deleted: Set<string>, busQueue: any
  const context = { sessionID: "ses_parent", agent: "build", messageID: "msg_call", id: "tool_call" }
  const source = process.env.QOL_NATIVE_PTY_SOURCE ?? path.resolve(import.meta.dir, "../src/native-pty.ts")
  const internal = (relative: string) => path.resolve(path.dirname(source), relative)
  let counter = 0
  beforeAll(async () => {
    const effectPath = path.resolve(modules!, "effect/dist/index.js")
    E = await import(effectPath)
    const { Effect, Context, Queue, Stream } = E
    services = {}
    for (const name of ["PersistentPty", "Permission", "Location", "Session", "Bus", "FileAccess", "Environment", "Config", "ShellSelect"])
      services[name] = Context.Service(`test.native.${name}`)
    class ToolFailure extends Error { constructor(input: any) { super(input.message); Object.assign(this, input) } }
    mock.module("@opencode/ai", () => ({ ToolFailure }))
    for (const [name, relative] of Object.entries({ PersistentPty: "../../persistent-pty.js", Permission: "../../permission.js",
      Location: "../../location.js", Session: "../../session.js", Bus: "../../bus.js", FileAccess: "../../file-access.js",
      Environment: "../../environment/index.js", Config: "../../config.js", ShellSelect: "../../shell/select.js" })) {
      const implementation = () => ({ [name]: { Service: services[name],
        ...(name === "FileAccess" ? { resolvePath: path.resolve } : {}),
        ...(name === "Environment" ? { typeFollowing: () => Effect.succeed("directory") } : {}),
        ...(name === "Config" ? { latest: () => ({ portable_shell_scanner: true }) } : {}) } })
      mock.module(internal(relative), implementation)
      mock.module(relative, implementation)
    }
    const parser = () => ({ ShellParse: { scan: (command: string) => {
      shellCommands.push(command); return Effect.succeed({ directories: [], commands: [{ resource: command, save: command }] })
    } } })
    mock.module(internal("../../shell/parse.js"), parser)
    mock.module("../../shell/parse.js", parser)
    mock.module("#shell-parser-wasm", () => ({ shellParserWasm: { bash: "" } }))
    Plugin = (await import(source)).Plugin
    terminals = new Map(); notifications = new Map(); callbacks = new Map(); deleted = new Set()
    assertions = []; writes = []; shellCommands = []; tools = new Map()
    busQueue = await Effect.runPromise(Queue.unbounded())
    const host = {
      PersistentPty: {
        list: (session?: string) => Effect.succeed([...terminals.values()].filter((info) => !session || info.sessionID === session)),
        get: (id: string) => terminals.has(id) ? Effect.succeed(terminals.get(id)) : Effect.fail(new Error("PTY missing")),
        create: (sessionID: string, input: any) => Effect.sync(() => {
          const info = { ...input, id: `pty_${++counter}`, sessionID, status: "running", output: { head: 0, tail: 0 } }
          terminals.set(info.id, info); return info
        }),
        attach: (id: string, input: any) => Effect.sync(() => {
          callbacks.set(id, input)
          return { activate() { if (terminals.get(id)?.status === "exited") input.onEvent({ type: "exited" }) }, detach() {} }
        }),
        replay: () => Effect.succeed({ data: Buffer.from("first\nERR one\nlast\nerr two"), requestedOffset: 0, availableOffset: 0, endOffset: 30, truncated: false }),
        write: (_id: string, data: string) => Effect.sync(() => { writes.push(data) }),
        resize: () => Effect.void,
        stop: (id: string) => Effect.sync(() => {
          const info = terminals.get(id); if (info) { info.status = "exited"; info.killed = true; callbacks.get(id)?.onEvent({ type: "exited" }) }
        }),
        remove: (id: string) => Effect.sync(() => { terminals.delete(id) }),
      },
      Permission: { assert: (request: any) => Effect.sync(() => { assertions.push(request) }) },
      Location: { directory: "/project", project: { id: "project_parent" } },
      Session: {
        get: (id: string) => deleted.has(id) ? Effect.fail(new Error("Session missing")) : Effect.succeed({ projectID: id === "ses_foreign_project" ? "project_other" : "project_parent" }),
        synthetic: (input: any) => notifications.has(input.id)
          ? Effect.fail({ _tag: "Session.SyntheticConflictError" }) : Effect.sync(() => { notifications.set(input.id, input) }),
      },
      Bus: { subscribe: () => Stream.fromQueue(busQueue) },
      FileAccess: { resolve: (input: any) => Effect.succeed({ absolute: input.path }), authorizeExternal: () => Effect.void },
      Environment: { files: {} }, Config: { entries: () => Effect.succeed([]) }, ShellSelect: { resolve: () => Effect.succeed("bash") },
    }
    scope = await Effect.runPromise(E.Scope.make())
    let effect = Plugin.effect({ app: { channel: "local" }, session: { hook: (_event: string, fn: any) => Effect.sync(() => { hook = fn }) },
      tool: { transform: (fn: any) => Effect.sync(() => fn({ add: (tool: any) => tools.set(tool.name, tool) })) } })
    for (const [name, service] of Object.entries(host)) effect = effect.pipe(Effect.provideService(services[name], service))
    await Effect.runPromise(effect.pipe(Effect.provideService(E.Scope.Scope, scope)))
  })
  afterAll(async () => { if (scope) await E.Effect.runPromise(E.Scope.close(scope, E.Exit.void)) })
  const invoke = async (name: string, input: any, ctx = context) => {
    const tool = tools.get(name)
    const decoded = E.Schema.decodeUnknownSync(tool.input)(input)
    return E.Effect.runPromise(tool.execute(decoded, ctx))
  }
  const spawn = (input = {}) => invoke("pty_spawn", { command: "bash", description: "contract", ...input })
  const drain = () => E.Effect.runPromise(E.Effect.yieldNow)
  test("old names/args/defaults and native shell permission capture", async () => {
    expect([...tools.keys()]).toEqual(["pty_spawn", "pty_write", "pty_read", "pty_list", "pty_kill", "pty_resize"])
    const { output } = await spawn({ args: ["-l"], env: { CUSTOM: "value" } })
    expect(output).toMatchObject({ cwd: "/project", cols: 80, rows: 24, title: "bash -l", env: { CUSTOM: "value" }, tool: { notifyOnExit: false, retainOnExit: true, agent: "build" } })
    expect(shellCommands.at(-1)).toBe("'bash' '-l'")
    expect(assertions.at(-1)).toMatchObject({ action: "shell", sessionID: "ses_parent", agent: "build", source: { type: "tool", id: "tool_call" } })
    await expect(spawn({ workdir: "/a", cwd: "/b" })).rejects.toThrow("Conflicting workdir and cwd")
    await expect(spawn({ timeoutSeconds: 0 })).rejects.toThrow()
    await expect(spawn({ timeoutSeconds: 1.5 })).rejects.toThrow()
    await expect(spawn({ command: "bash", description: "x", sessionID: "forged" })).resolves.toBeDefined()
    expect([...terminals.values()].at(-1).sessionID).toBe("ses_parent")
  })
  test("write escapes and exited rejection, regex original line pagination", async () => {
    const { output } = await spawn()
    await invoke("pty_write", { id: output.id, data: "echo hi\\n\\x03\\u0041\\\\" })
    expect(writes.at(-1)).toBe("echo hi\n\x03A\\")
    const result = await invoke("pty_read", { id: output.id, pattern: "^err", ignoreCase: true, offset: 1, limit: 1 })
    expect(result.output.lines).toEqual([{ line: 4, text: "err two" }])
    expect(result.content).toStartWith("Status: running")
    await expect(invoke("pty_read", { id: output.id, pattern: "[" })).rejects.toThrow("Invalid regex")
    await invoke("pty_kill", { id: output.id })
    expect(terminals.has(output.id)).toBe(true)
    await expect(invoke("pty_write", { id: output.id, data: "x" })).rejects.toThrow("exited")
    await invoke("pty_kill", { id: output.id, cleanup: true })
    expect(terminals.has(output.id)).toBe(false)
  })
  test("cross-session/project access cannot forge ownership", async () => {
    const { output } = await spawn()
    for (const name of ["pty_read", "pty_write", "pty_kill", "pty_resize"]) {
      await expect(invoke(name, { id: output.id, data: "x", cols: 80, rows: 24 }, { ...context, sessionID: "ses_other" })).rejects.toThrow("access denied")
    }
    await expect(invoke("pty_list", {}, { ...context, sessionID: "ses_foreign_project" })).rejects.toThrow("access denied")
    const listed = await invoke("pty_list", {}, { ...context, sessionID: "ses_other" })
    expect(listed.output).toEqual([])
  })
  test("exit notification once across recovery, deletion suppresses and cleans", async () => {
    const { output } = await spawn({ notifyOnExit: true })
    terminals.get(output.id).status = "exited"
    callbacks.get(output.id).onEvent({ type: "exited" })
    await drain(); await drain()
    expect(notifications.size).toBe(1)
    await E.Effect.runPromise(hook()); await drain(); await drain()
    expect(notifications.size).toBe(1)
    const child = await spawn({ notifyOnExit: true })
    deleted.add("ses_parent")
    await E.Effect.runPromise(E.Queue.offer(busQueue, { data: { sessionID: "ses_parent" } }))
    await drain(); await drain()
    expect(terminals.has(child.output.id)).toBe(false)
    expect(notifications.size).toBe(1)
  })
})
