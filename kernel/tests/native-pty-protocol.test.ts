import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

// This imports the official daemon transport after native-pty-compat.patch,
// without mocking schemas/network/processes. Its source must resolve the core's
// actual dependencies. No binary/source environment means explicit skips.
const source = process.env.QOL_NATIVE_CORE_DAEMON_SOURCE
const modules = process.env.QOL_NATIVE_CORE_MODULES
const binary = process.env.QOL_NATIVE_PTY_BIN
describe.skipIf(!source || !modules || !binary)("patched official core/native wire integration", () => {
  let E: any, core: any, transport: any, scope: any, directory: string
  beforeAll(async () => {
    E = await import(path.resolve(modules!, "effect/dist/index.js"))
    core = await import(source!)
    directory = await mkdtemp("/tmp/opencode/qol-pty-core-wire-")
    scope = await E.Effect.runPromise(E.Scope.make())
    transport = await E.Effect.runPromise(core.makeDaemonTransport(directory, "contract", async () => binary)
      .pipe(E.Effect.provideService(E.Scope.Scope, scope)))
  })
  afterAll(async () => {
    if (transport) await E.Effect.runPromise(transport.shutdown)
    if (scope) await E.Effect.runPromise(E.Scope.close(scope, E.Exit.void))
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  test("public HTTP CreateInput cannot set tool metadata or body session/takeover", async () => {
    const schema = await import(path.resolve(path.dirname(source!), "../../../schema/src/persistent-pty.ts"))
    const decoded = E.Schema.decodeUnknownSync(schema.CreateInput)({ command: "bash", args: [], title: "HTTP", env: {},
      tool: { retainOnExit: true, projectID: "forged", completionID: "forged" }, sessionID: "forged", takeover: true })
    expect(decoded).not.toHaveProperty("tool")
    expect(decoded).not.toHaveProperty("sessionID")
    expect(decoded).not.toHaveProperty("takeover")
    expect(schema.Info.fields).toHaveProperty("tool")
  })
  test("real terminal metadata, observer exit, replay and idempotent stop decode", async () => {
    const created = await E.Effect.runPromise(transport.request({ op: "create", program: "bash",
      args: ["-c", "read -r answer; printf 'core-final:%s\\n' \"$answer\"; exit 23"],
      cwd: directory, title: "core-wire", group_id: "ses_contract", env: {}, cols: 80, rows: 24,
      tool: { retainOnExit: true, projectID: "project_contract" } }, true))
    expect(created.type).toBe("created")
    expect(created.terminal.tool.retainOnExit).toBe(true)
    expect(created.terminal.created_at).toBeGreaterThan(0)
    expect(created.terminal.termination_error).toBeNull()
    const schema = await import(path.resolve(path.dirname(source!), "../../../schema/src/persistent-pty.ts"))
    const decodeInfo = E.Schema.decodeUnknownSync(schema.Info)
    const info = { id: "pty_1", title: "core-wire", command: "bash", args: [], cwd: directory,
      status: "running", pid: created.terminal.pid, sessionID: "ses_contract", userTitle: null, foregroundProcess: null,
      size: { cols: 80, rows: 24 }, output: { head: 0, tail: 0 } }
    for (const value of [undefined, null]) {
      expect(decodeInfo({ ...info, tool: value, createdAt: value, exitSignal: value,
        killed: value, timedOut: value, terminationError: value })).toMatchObject(info)
    }
    expect(decodeInfo(info)).toEqual(info)
    expect(decodeInfo({ ...info, tool: { retainOnExit: true }, createdAt: 1, exitSignal: "SIGTERM",
      killed: true, timedOut: false, terminationError: "stop failed" })).toMatchObject({
        exitSignal: "SIGTERM", killed: true, timedOut: false, terminationError: "stop failed" })
    const failure = E.Schema.decodeUnknownSync(core.WireTerminal)({ ...created.terminal, termination_error: "timeout termination failed: injected; retry pty_kill" })
    expect(failure.termination_error).toContain("retry pty_kill")
    let finish!: (event: any) => void
    const finished = new Promise((resolve) => { finish = resolve })
    const attachment = await E.Effect.runPromise(transport.subscribe(created.terminal.id, { cursor: 0,
      attachmentID: "core-observer", role: "observer", onEnd() {},
      onEvent(event: any) { if (event.type === "exited") finish(event) } }))
    attachment.activate()
    await E.Effect.runPromise(transport.request({ op: "write", id: created.terminal.id, data_base64: Buffer.from("hello\n").toString("base64") }))
    expect((await finished as any).exitCode).toBe(23)
    attachment.detach()
    const replay = await E.Effect.runPromise(transport.request({ op: "replay", id: created.terminal.id, offset: 0 }))
    expect(replay.type).toBe("replay")
    expect(Buffer.from(replay.data_base64, "base64").toString()).toContain("core-final:hello")
    expect(replay.end_offset).toBeGreaterThan(0)
    expect(replay.truncated).toBe(false)
    expect((await E.Effect.runPromise(transport.request({ op: "stop", id: created.terminal.id }))).type).toBe("ok")
    expect((await E.Effect.runPromise(transport.request({ op: "stop", id: created.terminal.id }))).type).toBe("ok")
    const listed = await E.Effect.runPromise(transport.request({ op: "list" }))
    expect(listed.terminals[0].lifecycle).toEqual({ status: "exited", exit_code: 23 })
    expect(listed.terminals[0].tool.retainOnExit).toBe(true)
  }, 15000)
  test("real core attachments retain exited tool panes; stop/replay/remove bridge", async () => {
    // Isolate only the app-node/Bus/Global shell around the real core service.
    // The layer, schemas, transport, subscriptions and daemon are production code.
    const busTag = E.Context.Service("test.native.protocol.Bus")
    const globalTag = E.Context.Service("test.native.protocol.Global")
    const require = createRequire(source!)
    mock.module(require.resolve("@opencode/util/effect/app-node"), () => ({ makeGlobalNode: (options: any) => options }))
    mock.module(require.resolve("@opencode/util/global"), () => ({ Global: { Service: globalTag } }))
    mock.module("../bus.js", () => ({ Bus: { Service: busTag } }))
    mock.module(path.resolve(path.dirname(source!), "../bus.js"), () => ({ Bus: { Service: busTag } }))
    mock.module("../shell/select.js", () => ({ ShellSelect: { environment: () => "bash" } }))
    mock.module(path.resolve(path.dirname(source!), "../shell/select.js"), () => ({ ShellSelect: { environment: () => "bash" } }))
    mock.module("#persistent-pty-binary", () => ({ available: true, resolveBinary: async () => binary }))
    const coreService = await import(path.join(path.dirname(source!), "index.ts"))
    const context = await E.Effect.runPromise(E.Layer.build(coreService.configured({ root: directory }).layer).pipe(
      E.Effect.provideService(E.Scope.Scope, scope),
      E.Effect.provideService(busTag, { publish: () => E.Effect.void, subscribe: () => E.Stream.empty }),
      E.Effect.provideService(globalTag, { state: directory, bin: directory }),
    ))
    const pty = E.Context.get(context, coreService.Service)
    try {
      const terminal = await E.Effect.runPromise(pty.create("ses_core", { command: "bash", args: ["-c", "read -r line; printf 'retained-pane-final\\n'"],
        title: "pane", cwd: directory, env: {}, tool: { retainOnExit: true } }))
      expect(terminal).not.toHaveProperty("exitSignal")
      expect(terminal).not.toHaveProperty("terminationError")
      const listed = await E.Effect.runPromise(pty.list("ses_core"))
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ id: terminal.id, status: "running" })
      expect(listed[0]).not.toHaveProperty("exitSignal")
      expect(listed[0]).not.toHaveProperty("terminationError")
      const renamed = await E.Effect.runPromise(pty.rename(terminal.id, "renamed tool pane"))
      expect(renamed.userTitle).toBe("renamed tool pane")
      expect(renamed.tool.retainOnExit).toBe(true)
      const ended = (role: string) => {
        let done!: () => void
        const promise = new Promise<void>((resolve) => { done = resolve })
        return { promise, attach: pty.attach(terminal.id, { cursor: 0, attachmentID: `core-${role}`, role,
          onEnd() {}, onEvent(event: any) { if (event.type === "exited") done() } }) }
      }
      const controller = ended("controller"), observer = ended("observer")
      const pane = await E.Effect.runPromise(controller.attach), watch = await E.Effect.runPromise(observer.attach)
      pane.activate(); watch.activate()
      await E.Effect.runPromise(pty.resize(terminal.id, 100, 30))
      await E.Effect.runPromise(pty.write(terminal.id, "done\n"))
      await Promise.all([controller.promise, observer.promise]); pane.detach(); watch.detach()
      const settled = await E.Effect.runPromise(pty.get(terminal.id))
      expect(settled.status).toBe("exited"); expect(settled.tool.retainOnExit).toBe(true)
      expect(Buffer.from((await E.Effect.runPromise(pty.replay(terminal.id))).data).toString()).toContain("retained-pane-final")
      const running = await E.Effect.runPromise(pty.create("ses_core", { command: "bash", args: ["-c", "read -r line"],
        title: "stop", cwd: directory, env: {}, tool: { retainOnExit: true } }))
      await E.Effect.runPromise(pty.stop(running.id))
      const killed = await E.Effect.runPromise(pty.get(running.id))
      expect(killed.killed).toBe(true); expect(killed.exitSignal).toBeTruthy()
      await E.Effect.runPromise(pty.replay(running.id))
      await E.Effect.runPromise(pty.remove(running.id))
      await expect(E.Effect.runPromise(pty.get(running.id))).rejects.toThrow()
    } finally { await E.Effect.runPromise(pty.shutdown()) }
  }, 15000)
})
