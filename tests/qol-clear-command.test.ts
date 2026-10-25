import { describe, expect, mock, test } from "bun:test";
import type { CommandDefinition, CommandInvocation } from "@opencode/plugin/promise/command";
import { setupServer, type Dependencies, type ServerContext } from "../plugins/clear-encrypted/src/index.ts";
import tui from "../plugins/clear-encrypted/src/tui.ts";
import { definition, reasons } from "../plugins/clear-encrypted/src/rpc.ts";

const committed = { ok: true as const, changedMessages: 2, changedEvents: 3, removedFields: 4 };
const invocation = (prompt: Partial<CommandInvocation["prompt"]> = {}) => ({
  sessionID: "ses-current", prompt: { text: "", ...prompt }, delivery: "steer",
}) as CommandInvocation;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function harness(edit?: (ctx: ServerContext, deps: Dependencies) => void) {
  const calls: string[] = [];
  let command!: CommandDefinition;
  let rpc!: Parameters<ServerContext["rpc"]["register"]>[1];
  const location = { directory: "/workspace", workspaceID: "ws-current" };
  const session = { id: "ses-current", projectID: "project-current", location };
  const ctx: ServerContext = {
    app: { version: "2.1.4", channel: "latest" },
    location: { ...location, project: { id: session.projectID } },
    session: {
      get: mock(async () => { calls.push("get"); return session; }),
      interrupt: mock(async () => { calls.push("interrupt"); }),
      wait: mock(async () => { calls.push("wait"); }),
    },
    command: { transform: mock(async edit => edit({ add: value => { command = value; } })) },
    rpc: { register: mock(async (schema, handlers) => { expect(schema).toBe(definition); rpc = handlers; }) },
  };
  const deps: Dependencies = {
    target: mock(async () => { calls.push("target"); return { dbPath: "/trusted/db", bun: "/trusted/bun" }; }),
    helper: mock(async () => { calls.push("helper"); return committed; }),
    timeout: 2_000,
  };
  edit?.(ctx, deps);
  await setupServer(ctx, deps);
  const rpcCall = (input: unknown, signal = new AbortController().signal) => rpc.clear(input, {
    signal, error: (type, message, data) => ({ type, message, data }),
  });
  return { command, rpcCall, ctx, deps, calls, session };
}

describe("clear-encrypted direct server command", () => {
  test("registers and executes without a model prompt, using the same guarded helper as RPC", async () => {
    const h = await harness();
    expect(h.command.name).toBe("clear-encrypted");
    expect(await h.command.execute(invocation())).toBeUndefined();
    expect(h.calls).toEqual(["target", "get", "interrupt", "wait", "helper"]);
    expect(h.ctx.session.interrupt).toHaveBeenCalledWith({ sessionID: "ses-current", resume: false }, { signal: expect.any(AbortSignal) });
    expect(h.deps.helper).toHaveBeenCalledWith({ operation: "clear", sessionID: "ses-current", directory: "/workspace", dbPath: "/trusted/db" }, "/trusted/bun", expect.any(AbortSignal));
    expect(await h.rpcCall({ sessionID: "ses-current" })).toEqual(committed);
  });

  test.each([
    { text: "/arbitrary/database" },
    { files: [{ uri: "file:///database" }] },
    { agents: [{ name: "agent" }] },
    { skills: [{ id: "skill" }] },
  ])("rejects arguments and attachments before touching the session: %j", async prompt => {
    const h = await harness();
    await expect(h.command.execute(invocation(prompt as Partial<CommandInvocation["prompt"]>))).rejects.toThrow(reasons.arguments);
    expect(h.calls).toEqual([]);
  });

  test.each(["id", "project", "directory", "workspace"])("rejects session %s mismatch before interrupt/helper", async field => {
    const h = await harness();
    if (field === "id") h.session.id = "ses-other";
    if (field === "project") h.session.projectID = "project-other";
    if (field === "directory") h.session.location.directory = "/other";
    if (field === "workspace") h.session.location.workspaceID = "ws-other";
    await expect(h.command.execute(invocation())).rejects.toThrow(reasons.location);
    expect(h.calls).toEqual(["target", "get"]);
  });

  test("refuses missing settlement capabilities and invalid current location", async () => {
    const h = await harness();
    const wait = h.ctx.session.wait;
    h.ctx.session.wait = undefined as unknown as typeof wait;
    await expect(h.command.execute(invocation())).rejects.toThrow(reasons.compatibility);
    expect(h.calls).toEqual([]);
    h.ctx.session.wait = wait;
    h.ctx.location.directory = "relative";
    await expect(h.command.execute(invocation())).rejects.toThrow(reasons.location);
    expect(h.calls).toEqual([]);
  });

  test("RPC rejects caller-selected paths", async () => {
    const h = await harness();
    expect(await h.rpcCall({ sessionID: "ses-current", dbPath: "/arbitrary" })).toMatchObject({ type: "failed", message: reasons.location });
    expect(h.calls).toEqual([]);
  });

  test("target failures are redacted and stop failures do not reach helper", async () => {
    const h = await harness((_ctx, deps) => { deps.target = mock(async () => { throw new Error("secret database path"); }); });
    await expect(h.command.execute(invocation())).rejects.toThrow(reasons.unknown);
    expect(h.deps.helper).not.toHaveBeenCalled();
    const stopped = await harness(ctx => { ctx.session.wait = mock(async () => { throw new Error("private state"); }); });
    await expect(stopped.command.execute(invocation())).rejects.toThrow(reasons.stopped);
    expect(stopped.deps.helper).not.toHaveBeenCalled();
  });

  test.each(["command", "rpc"])("%s holds the shared pending entry against the other entry point", async first => {
    const entered = deferred();
    const release = deferred<typeof committed>();
    const h = await harness((_ctx, deps) => { deps.helper = mock(async () => { entered.resolve(); return release.promise; }); });
    const pending = first === "command" ? h.command.execute(invocation()) : h.rpcCall({ sessionID: "ses-current" });
    await entered.promise;
    try {
      if (first === "command") expect(await h.rpcCall({ sessionID: "ses-current" })).toMatchObject({ message: reasons.busy });
      else await expect(h.command.execute(invocation())).rejects.toThrow(reasons.busy);
      expect(h.deps.helper).toHaveBeenCalledTimes(1);
    } finally { release.resolve(committed); await pending; }
    expect(await h.rpcCall({ sessionID: "ses-current" })).toEqual(committed);
    expect(h.deps.helper).toHaveBeenCalledTimes(2);
  });

  test("command timeout cancels preflight and releases pending without launching helper", async () => {
    let signal!: AbortSignal;
    const h = await harness((ctx, deps) => {
      deps.timeout = 10;
      ctx.session.get = mock(async (_input, options) => { signal = options!.signal; return new Promise(() => {}); });
    });
    await expect(h.command.execute(invocation())).rejects.toThrow(reasons.cancelled);
    expect(signal.aborted).toBe(true);
    expect(h.deps.helper).not.toHaveBeenCalled();
    h.ctx.session.get = mock(async () => h.session);
    expect(await h.rpcCall({ sessionID: "ses-current" })).toEqual(committed);
  });

  test("RPC cancellation remains connected to the shared guard", async () => {
    const entered = deferred();
    let signal!: AbortSignal;
    const h = await harness((ctx) => {
      ctx.session.get = mock(async (_input, options) => { signal = options!.signal; entered.resolve(); return new Promise(() => {}); });
    });
    const controller = new AbortController();
    const pending = h.rpcCall({ sessionID: "ses-current" }, controller.signal);
    await entered.promise;
    controller.abort();
    expect(await pending).toMatchObject({ type: "failed", message: reasons.cancelled });
    expect(signal.aborted).toBe(true);
    expect(h.deps.helper).not.toHaveBeenCalled();
  });

  test("TUI exposes only a palette shortcut, leaving slash ownership to the server", () => {
    let layer!: ReturnType<Parameters<Parameters<typeof tui.setup>[0]["keymap"]["layer"]>[0]>;
    tui.setup({ keymap: { layer: factory => { layer = factory(); } } } as Parameters<typeof tui.setup>[0]);
    expect(layer.commands).toHaveLength(1);
    expect(layer.commands[0]!.palette).toBe(true);
    expect(layer.commands[0]).not.toHaveProperty("slash");
  });
});
