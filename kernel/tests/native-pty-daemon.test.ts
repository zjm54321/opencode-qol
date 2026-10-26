import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import net from "node:net"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { transcript } from "../src/native-pty/transcript"

// Explicit binary is mandatory for runtime coverage; a missing binary is a skip,
// never a mocked daemon pass. Run: QOL_NATIVE_PTY_BIN=<built>/bin/opencode-pty bun test ...
const binary = process.env.QOL_NATIVE_PTY_BIN
type Frame = Record<string, any>
let directory: string, registration: Frame, child: ChildProcess, owner: Connection
class Connection {
  readonly attachmentID = crypto.randomUUID()
  readonly controllerChanges: Frame[] = []
  initialReplay = Buffer.alloc(0)
  private data = Buffer.alloc(0)
  private frames: Frame[] = []
  private waiting: Array<{ resolve: (frame: Frame) => void; reject: (error: Error) => void }> = []
  readonly socket: net.Socket
  constructor() {
    this.socket = net.createConnection(registration.socket)
    this.socket.on("data", (data) => {
      this.data = Buffer.concat([this.data, data])
      while (this.data.length >= 4 && this.data.length >= this.data.readUInt32BE(0) + 4) {
        const size = this.data.readUInt32BE(0)
        const payload = this.data.subarray(4, 4 + size)
        this.data = this.data.subarray(4 + size)
        const frame = payload[0] === 0
          ? { type: "output", start: Number(payload.readBigUInt64BE(1)), end: Number(payload.readBigUInt64BE(9)), bytes: payload.subarray(17) }
          : JSON.parse(payload.toString())
        if (frame.type === "controller_changed") this.controllerChanges.push(frame)
        const waiting = this.waiting.shift()
        if (waiting) waiting.resolve(frame)
        else this.frames.push(frame)
      }
    })
    this.socket.on("error", (error) => { for (const waiter of this.waiting.splice(0)) waiter.reject(error) })
    this.socket.on("close", () => { for (const waiter of this.waiting.splice(0)) waiter.reject(new Error("daemon connection closed")) })
  }
  send(request: Frame) {
    const payload = Buffer.from(JSON.stringify({ token: registration.token, request }))
    const size = Buffer.alloc(4); size.writeUInt32BE(payload.length)
    this.socket.write(Buffer.concat([size, payload]))
  }
  async next(): Promise<Frame> {
    const frame = this.frames.shift()
    if (frame) return frame
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("daemon response timed out")), 15000)
      this.waiting.push({ resolve: (frame) => { clearTimeout(timer); resolve(frame) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    })
  }
  close() { this.socket.destroy() }
}
async function request(request: Frame) {
  const connection = new Connection()
  try { connection.send(request); return await connection.next() }
  finally { connection.close() }
}
async function create(command: string, tool: Frame = {}) {
  const result = await request({ op: "create", program: "bash", args: ["-c", command], cwd: directory,
    title: "contract", group_id: "ses_contract", env: { QOL_TEST_ENV: "inherited-override" }, cols: 80, rows: 24,
    tool: { retainOnExit: true, projectID: "project_contract", ...tool } })
  expect(result.type).toBe("created")
  return result.terminal as Frame
}
async function subscribe(id: number, role = "observer") {
  const connection = new Connection()
  connection.send({ op: "subscribe", id, offset: 0, attachment_id: connection.attachmentID, role, takeover: false })
  const attached = await connection.next()
  expect(attached.type).toBe("attached"); expect(attached.role).toBe(role)
  connection.initialReplay = Buffer.from(attached.replay_base64, "base64")
  return connection
}
async function exited(connection: Connection) {
  for (;;) { const frame = await connection.next(); if (frame.type === "exited") return frame }
}
async function info(id: number) { return (await request({ op: "list" })).terminals.find((info: Frame) => info.id === id) as Frame | undefined }
async function replay(id: number) {
  const result = await request({ op: "replay", id, offset: 0 })
  expect(result.type).toBe("replay")
  return { requestedOffset: result.requested_offset, availableOffset: result.available_offset,
    endOffset: result.end_offset, truncated: result.truncated, data: Buffer.from(result.data_base64, "base64") }
}
async function bounded<T>(operation: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("native group termination exceeded 2000ms")), milliseconds)
    })])
  } finally { clearTimeout(timer!) }
}
async function processState(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]) }
  } catch (error: any) { if (error.code === "ENOENT") return; throw error }
}

describe.skipIf(!binary)("real patched native daemon", () => {
  beforeAll(async () => {
    directory = await mkdtemp("/tmp/opencode/qol-pty-runtime-")
    child = spawn(binary!, ["daemon", "--runtime-dir", directory, "--name", "contract"], { stdio: "ignore" })
    // Only startup discovery retries; terminal completion uses native events.
    for (let attempt = 0; attempt < 200; attempt++) {
      try { registration = JSON.parse(await readFile(`${directory}/contract/service.json`, "utf8")); break }
      catch { await Bun.sleep(20) }
    }
    if (!registration) throw new Error("native daemon did not start")
    owner = new Connection()
    owner.send({ op: "own", instance_id: registration.instance_id })
    expect((await owner.next()).type).toBe("owned")
  })
  afterAll(async () => {
    if (registration) await request({ op: "shutdown" })
    owner?.close()
    child?.kill()
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  test("spawn/write interaction, defaults/env, final output, exit code and late replay", async () => {
    const terminal = await create(`printf '%s:%s\\n' "$TERM" "$QOL_TEST_ENV"; read -r answer; printf 'answer=%s\\n' "$answer"; exit 7`)
    expect(terminal.pid).toBeGreaterThan(0)
    expect(terminal.cols).toBe(80); expect(terminal.rows).toBe(24)
    expect(terminal.created_at).toBeGreaterThan(0)
    const sub = await subscribe(terminal.id)
    expect((await request({ op: "write", id: terminal.id, data_base64: Buffer.from("hello\n").toString("base64") })).type).toBe("ok")
    expect((await exited(sub)).exit_code).toBe(7); sub.close()
    const output = Buffer.from((await replay(terminal.id)).data).toString()
    expect(output).toContain("xterm-256color:inherited-override")
    expect(output).toContain("answer=hello")
    expect((await info(terminal.id))?.lifecycle).toEqual({ status: "exited", exit_code: 7 })
    const late = await subscribe(terminal.id); expect((await exited(late)).exit_code).toBe(7); late.close()
    expect((await request({ op: "write", id: terminal.id, data_base64: "eA==" })).type).toBe("error")
  })
  test("real signal is preserved", async () => {
    const terminal = await create("kill -TERM $$")
    const sub = await subscribe(terminal.id); await exited(sub); sub.close()
    expect((await info(terminal.id))?.exit_signal).toBeTruthy()
  })
  test("pane controller attachment and natural exit retain daemon replay", async () => {
    const terminal = await create("read -r line; printf 'pane-final\\n'")
    const pane = await subscribe(terminal.id, "controller")
    const observer = await subscribe(terminal.id)
    pane.close()
    // Pure observer must never be auto-promoted when a pane disconnects.
    const result = await request({ op: "write", id: terminal.id, data_base64: Buffer.from("done\n").toString("base64") })
    expect(result.type).toBe("ok")
    await exited(observer); observer.close()
    expect(observer.controllerChanges.some((event) => event.attachment_id === observer.attachmentID)).toBe(false)
    expect((await info(terminal.id))?.tool.retainOnExit).toBe(true)
    expect(Buffer.from((await replay(terminal.id)).data).toString()).toContain("pane-final")
  })
  test("idempotent stop waits for settlement, preserves output; terminate removes", async () => {
    const terminal = await create("printf 'before-stop\\n'; read -r line")
    const sub = await subscribe(terminal.id)
    // Handshake on actual native output, not a scheduling delay or read poll.
    if (!sub.initialReplay.length) for (;;) { if ((await sub.next()).type === "output") break }
    expect((await request({ op: "stop", id: terminal.id })).type).toBe("ok")
    await exited(sub); sub.close()
    expect((await request({ op: "stop", id: terminal.id })).type).toBe("ok")
    const settled = await info(terminal.id)
    expect(settled?.lifecycle.status).toBe("exited"); expect(settled?.killed).toBe(true)
    expect(settled?.exit_signal).toBeTruthy()
    expect((await replay(terminal.id)).endOffset).toBeGreaterThan(0)
    expect((await request({ op: "terminate", id: terminal.id })).type).toBe("ok")
    expect(await info(terminal.id)).toBeUndefined()
    expect((await request({ op: "replay", id: terminal.id, offset: 0 })).type).toBe("error")
  })
  test("service writes/resizes to retained tools preserve pane control and ordinary UI restrictions", async () => {
    const terminal = await create("read -r line; printf 'tool-input:%s\\n' \"$line\"")
    const pane = await subscribe(terminal.id, "controller"), observer = await subscribe(terminal.id)
    expect((await request({ op: "write", id: terminal.id, attachment_id: "forged-controller", data_base64: "eA==" })).type).toBe("error")
    expect((await request({ op: "resize", id: terminal.id, cols: 100, rows: 40 })).type).toBe("ok")
    expect((await request({ op: "write", id: terminal.id, data_base64: Buffer.from("hello\n").toString("base64") })).type).toBe("ok")
    await exited(observer); pane.close(); observer.close()
    expect(observer.controllerChanges.some((event) => event.attachment_id === observer.attachmentID)).toBe(false)
    const ordinary = await create("read -r line", { retainOnExit: false })
    const controller = await subscribe(ordinary.id, "controller")
    expect((await request({ op: "write", id: ordinary.id, data_base64: "eA==" })).type).toBe("error")
    expect((await request({ op: "resize", id: ordinary.id, cols: 100, rows: 40 })).type).toBe("error")
    await request({ op: "stop", id: ordinary.id }); controller.close()
  })
  test("native >2MiB crop and UTF8 replay boundary", async () => {
    const terminal = await create("printf '界%.0s' {1..750000}; printf '\\nFINAL😀'")
    const sub = await subscribe(terminal.id); await exited(sub); sub.close()
    const raw = await replay(terminal.id)
    expect(raw.truncated).toBe(true); expect(raw.data.length).toBe(2 * 1024 * 1024)
    expect(raw.availableOffset).toBeGreaterThan(0)
    const result = transcript(raw, {})
    expect(result.lines.at(-1)?.text).toBe("FINAL😀")
    expect(result.lines[0]?.text).not.toContain("�")
  }, 30000)
  test("daemon deadline survives server handoff; late subscription compensates exit", async () => {
    const terminal = await create("printf 'deadline-start\\n'; read -r line", {
      deadline: Date.now() + 300, notifyOnExit: true, completionID: "msg_contract-stable" })
    owner.send({ op: "prepare_handoff" })
    const handoff = await owner.next(); expect(handoff.type).toBe("handoff")
    owner.close()
    const late = await subscribe(terminal.id); await exited(late); late.close()
    owner = new Connection(); owner.send({ op: "own", instance_id: registration.instance_id, ticket: handoff.ticket })
    expect((await owner.next()).type).toBe("owned")
    const settled = await info(terminal.id)
    expect(settled?.timed_out).toBe(true); expect(settled?.killed).toBe(true)
    expect(settled?.tool.completionID).toBe("msg_contract-stable")
    const compensation = await subscribe(terminal.id); await exited(compensation); compensation.close()
    expect((await replay(terminal.id)).endOffset).toBeGreaterThan(0)
  })
  for (const mode of ["stop", "timeout"] as const) test.skipIf(process.platform !== "linux")(`${mode} settles when a background sleep holds the slave FD`, async () => {
    // Exact shell shape under review, with an output-event handshake proving
    // the descendant exists before termination. No sleep/read completion poll.
    const terminal = await create("sleep 60 & child=$!; printf 'CHILD_PID=%s\\n' \"$child\"; wait",
      mode === "timeout" ? { deadline: Date.now() + 1000 } : { retainOnExit: false })
    let sub: Connection | undefined, settled = false, descendant = 0
    try {
      sub = await subscribe(terminal.id)
      let output = sub.initialReplay.toString()
      const witness = await bounded((async () => {
        for (;;) {
          const match = /CHILD_PID=(\d+)\r?\n/.exec(output)
          if (match) return Number(match[1])
          const event = await sub!.next()
          if (event.type === "output") output += event.bytes.toString()
          if (event.type === "exited") throw new Error("terminal exited before descendant handshake")
        }
      })())
      descendant = witness
      const before = await processState(descendant)
      expect(before?.group).toBe(terminal.pid)
      expect(before?.session).toBe(terminal.pid)
      const start = Date.now()
      if (mode === "stop") expect((await bounded(request({ op: "stop", id: terminal.id }))).type).toBe("ok")
      await bounded(exited(sub))
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(2000)
      const after = await processState(descendant)
      // A reparented zombie is already dead and holds no FDs; PID 1 reaps it.
      expect(!after || after.state === "Z" || after.state === "X").toBe(true)
      const ended = await info(terminal.id)
      expect(ended?.lifecycle.status).toBe("exited")
      expect(ended?.killed).toBe(true)
      expect(ended?.timed_out).toBe(mode === "timeout")
      expect(ended?.tool.retainOnExit).toBe(mode === "timeout")
      expect(ended?.exit_signal).toBeTruthy()
      console.info(`native ${mode}: shell=${terminal.pid} child=${descendant} settled=${elapsed}ms childState=${after?.state ?? "absent"} signal=${ended?.exit_signal}`)
      expect(Buffer.from((await replay(terminal.id)).data).toString()).toContain(`CHILD_PID=${descendant}`)
      settled = true
    } finally {
      // Failure cleanup is scoped to the fixture's proven private process group.
      // This also bounds a regression against the old shell-only SIGHUP killer.
      if (!settled) try { process.kill(-terminal.pid, "SIGKILL") } catch (error: any) { if (error.code !== "ESRCH") throw error }
      sub?.close()
      await request({ op: "terminate", id: terminal.id })
    }
  }, 10000)
})
