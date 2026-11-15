import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Only the host registration/context is isolated.
mock.module("@opencode/plugin", () => ({ Plugin: { define: (definition: unknown) => definition } }));
const { default: sessionPlugin, createSessionReaderPlugin, sessionReadInput } = await import("../plugins/session-reader/src/index.ts");
const { OpenCodeClient, readServiceRegistration } = await import("../plugins/session-reader/src/client.ts");
const { ACTIVE_CONTEXT_NOTICE } = await import("../plugins/session-reader/src/history.ts");

let workspace: string;
let originalEnv: NodeJS.ProcessEnv;
const originalFetch = globalThis.fetch;
const password = "test-service-password";
const cursor = { previous: "prev-token", next: "next-token" };
const session = { id: "ses-test", title: "Test title", directory: "/workspace", parentID: "ses_parent", agent: "orchestrator", model: { id: "fixture-model" }, outcome: "failed", cost: 1.25, time: { created: 1_794_556_580_000, updated: 1_794_556_596_000 } };
const testRoot = path.join(tmpdir(), "opencode");

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true });
  workspace = await mkdtemp(path.join(testRoot, "qol-native-tools-"));
  originalEnv = { ...process.env };
  process.env.XDG_CONFIG_HOME = path.join(workspace, "config");
  process.env.XDG_STATE_HOME = path.join(workspace, "state");
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  mock.restore();
  process.env = originalEnv;
  await rm(workspace, { recursive: true, force: true });
});

async function register(plugin: any, channel = "prod") {
  const tools = new Map<string, any>();
  const context = {
    app: { name: "opencode", version: "2.2.5", channel },
    location: { directory: workspace },
    session: { context: async () => [] },
    tool: { transform: async (edit: any) => {
      edit({ add: (tool: any) => tools.set(tool.name, tool) });
      return { dispose() {} };
    } },
  };
  await plugin.setup(context);
  return { tools, context };
}

function execution(signal = new AbortController().signal) { return { sessionID: "ses-current", signal }; }

async function writeRegistration(directory: string, filename = "service.json", overrides: Record<string, unknown> = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), JSON.stringify({
    id: "test-service", version: "2.2.5", url: "http://127.0.0.1:12345", pid: process.pid, password, ...overrides,
  }));
}

function call(name: string, input: unknown, output = "ok", status = "completed", metadata?: Record<string, unknown>, error?: unknown) {
  return { type: "tool", name, state: { status, input, content: [{ type: "text", text: output }], metadata, error } };
}

function historyFixture(): any[] {
  const messages = [
    { type: "user", text: "Restore this project.\nKeep this user prompt verbatim.  " },
    { type: "assistant", content: [call("todowrite", { todos: [{ content: "Old pending task", status: "pending" }] })] },
    { type: "assistant", content: [{ type: "text", text: "Writing the first file." }, call("write", { path: "/workspace/a.ts", content: "export const blue = true;" })] },
    { type: "user", text: "Please use the blue option." },
    { type: "assistant", content: [{ type: "reasoning", text: "Private reasoning about the choice." }, call("question", { questions: [{ question: "Which color?" }, { question: "Run tests?" }] }, "answers recorded", "completed", { answers: [["blue"], ["yes"]] }), call("grep", { pattern: "blue", path: "/workspace" }, "A tool-output-only keyword: spectrum") ] },
    { type: "assistant", content: [call("subagent", { agent: "fixer", description: "Implement blue feature", prompt: "The full child brief." }, "Child session: ses_child1", "completed", { sessionID: "ses_child1" })] },
    { type: "synthetic", text: "Child ses_child1 result: changed /workspace/a.ts; suite passed." },
    { type: "assistant", content: [call("edit", { path: "/workspace/a.ts", oldText: "true", newText: "false" }), call("apply_patch", { patchText: "*** Begin Patch\n*** Add File: /workspace/b.ts\n+blue\n*** Update File: /workspace/b.ts\n*** Move to: /workspace/c.ts\n*** End Patch" })] },
    { type: "assistant", content: [call("compress", { content: "m00001–m00003 Orientation\nOld running summary.\nm00004–m00008 Decision\nWe chose blue." })] },
    { type: "compaction", status: "completed", summary: "Native compaction state: keep blue." },
    { type: "user", text: "Continue exactly from here." },
    { type: "assistant", content: [call("todowrite", { todos: [{ content: "Completed task", status: "completed" }, { content: "Current task", status: "in_progress" }, { content: "Pending task", status: "pending" }, { content: "Cancelled task", status: "cancelled" }] }), call("todowrite", { todos: [{ content: "Unfinished replacement must not win", status: "pending" }] }, "", "running")] },
    { type: "assistant", content: [{ type: "reasoning", text: "Late reasoning keyword: rationale." }, call("compress", { content: JSON.stringify([{ startId: "m00009", endId: "m00012", summary: "Newest durable summary: preserve blue." }]) }), call("compress", { summary: "Legacy plain summary string." })] },
    { type: "assistant", content: [call("read", { path: "/workspace/a.ts" }, `BEGIN_MARKER-${"x".repeat(12_000)}-END_MARKER needle-haystack`), { type: "text", text: "An unrelated assistant text part." }] },
    { type: "assistant", finish: "error", error: { type: "provider.transport", message: "Transport timed out" }, content: [{ type: "reasoning", text: "Final late reasoning." }, call("shell", { command: "do-late-work" }, "", "running"), call("shell", { command: "broken" }, "", "error", undefined, "boom")] },
    { type: "idle", outcome: "failed" },
  ];
  return messages.map((message, index) => ({ id: `msg_fixture_${index + 1}`, time: { created: session.time.created + index * 1_000 }, ...(message.type === "assistant" ? { agent: "orchestrator", model: { id: "fixture-model" }, finish: "tool-calls" } : {}), ...message }));
}

function mockHistory(messages = historyFixture()) {
  const get = spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
  const pages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockResolvedValue({ data: messages, cursor: {} });
  const children = [{ id: "ses_child1", parentID: session.id, title: "Blue child", agent: "fixer", outcome: "succeeded", time: session.time }];
  const list = spyOn(OpenCodeClient.prototype, "listSessions").mockResolvedValue({ data: children, cursor: {} });
  return { get, pages, list };
}

describe("direct session tools", () => {
  test("service discovery reads XDG_STATE_HOME instead of stale config and keeps explicit overrides", async () => {
    const configDirectory = path.join(process.env.XDG_CONFIG_HOME!, "opencode");
    await mkdir(configDirectory, { recursive: true });
    for (const filename of ["service.json", "service-prod.json"]) {
      await writeFile(path.join(configDirectory, filename), JSON.stringify({ port: 49375, password: "stale" }));
    }
    process.env.OPENCODE_CONFIG_DIR = configDirectory;
    const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
    await writeRegistration(directory);
    expect(await readServiceRegistration()).toEqual({ url: "http://127.0.0.1:12345/", password });
    const override = path.join(workspace, "override");
    await writeRegistration(override, "service.json", { url: "https://localhost:12346", password: "override" });
    expect(await readServiceRegistration(override)).toEqual({ url: "https://localhost:12346/", password: "override" });
    await rm(path.join(directory, "service.json"));
    await expect(readServiceRegistration()).rejects.toThrow("OpenCode service registration not found");
  });

  test.each([undefined, ""])("service discovery uses ~/.local/state when XDG_STATE_HOME is %j", async value => {
    if (value === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = value;
    const directory = path.join(workspace, ".local", "state", "opencode");
    await writeRegistration(directory);
    // Bun caches os.homedir(): give the child its isolated HOME before startup.
    const client = path.join(import.meta.dir, "../plugins/session-reader/src/client.ts");
    const child = Bun.spawnSync([process.execPath, "--eval", `import { readServiceRegistration } from ${JSON.stringify(client)}; console.log(JSON.stringify(await readServiceRegistration()));`], {
      env: { ...process.env, HOME: workspace },
    });
    expect(child.stderr.toString()).toBe("");
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual({ url: "http://127.0.0.1:12345/", password });
  });

  test.each([
    ["latest", "service.json"], ["dev", "service.json"], ["beta", "service.json"], ["next", "service.json"],
    ["prod", "service-prod.json"], ["local", "service-local.json"], ["feature/test", "service-feature-test.json"],
  ])("service discovery selects the %s channel registration", async (channel, filename) => {
    const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
    await writeRegistration(directory, filename);
    expect(await readServiceRegistration(undefined, channel)).toEqual({ url: "http://127.0.0.1:12345/", password });
  });

  test("channel registration wins and never falls through to unrelated channels or saved config", async () => {
    const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
    await writeRegistration(directory, "service.json", { password: "other-channel" });
    await writeRegistration(directory, "service-prod.json", { url: "http://localhost:12347" });
    expect(await readServiceRegistration(undefined, "prod")).toEqual({ url: "http://localhost:12347/", password });
    await rm(path.join(directory, "service-prod.json"));
    await expect(readServiceRegistration(undefined, "prod")).rejects.toThrow("service-prod.json");
  });

  test.each([
    null, {}, { port: 49375, password: "stale" }, { pid: 0 }, { pid: 1.5 }, { pid: "123" },
    { password: 123 }, { version: false }, { id: false }, { url: "not-a-url" },
    { url: "file:///tmp/service" }, { url: "http://embedded:private@localhost:12345" },
  ])("invalid service registration is rejected without exposing its contents: %#", async override => {
    const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
    await writeRegistration(directory);
    if (override === null || Object.keys(override).length === 0 || "port" in override) {
      await writeFile(path.join(directory, "service.json"), JSON.stringify(override));
    } else await writeRegistration(directory, "service.json", override);
    try { await readServiceRegistration(); throw new Error("expected failure"); } catch (error) {
      expect((error as Error).message).toContain("Invalid OpenCode service");
      expect((error as Error).message).not.toContain(password);
      expect((error as Error).message).not.toContain("private");
    }
  });

  test("malformed JSON and unreadable registrations report safe errors", async () => {
    const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, "service.json");
    await writeFile(file, `{"password":"${password}", invalid}`);
    await expect(readServiceRegistration()).rejects.toThrow("Invalid JSON in OpenCode service registration");
    await rm(file);
    await mkdir(file);
    await expect(readServiceRegistration()).rejects.toThrow("Cannot read OpenCode service registration");
  });

  test.each(["disabled", "missing", "offline"])("standalone %s service falls back to native list/get/context", async state => {
    const directory = path.join(process.env.XDG_CONFIG_HOME!, "opencode");
    await mkdir(directory, { recursive: true });
    if (state !== "missing") await writeFile(path.join(directory, "service.json"), JSON.stringify(state === "disabled" ? { disabled: true } : { port: 12345, password: "offline" }));
    if (state === "offline") await writeRegistration(path.join(process.env.XDG_STATE_HOME!, "opencode"), "service-prod.json");
    globalThis.fetch = mock(async () => { throw new Error("connection refused"); }) as typeof fetch;
    const { tools, context } = await register(sessionPlugin);
    const messages = [
      { role: "user", text: "first question" },
      { role: "assistant", text: "first answer" },
      { role: "user", text: "last question" },
      { role: "assistant", text: "last answer" },
    ];
    const list = mock(async () => ({ data: [session], cursor }));
    const get = mock(async () => ({ data: session }));
    const active = mock(async () => ({ data: messages }));
    Object.assign(context.session, { list, get, context: active });
    const listed = await tools.get("session_list").execute({ limit: 1, order: "asc", cursor: "native-cursor" }, execution());
    expect(listed.metadata).toMatchObject({ count: 1, cursor, source: "active-context" });
    expect(listed.content).toContain(ACTIVE_CONTEXT_NOTICE);
    expect(list).toHaveBeenCalledWith({ search: undefined, directory: workspace, parentID: undefined, limit: 1, order: undefined, cursor: "native-cursor" });
    const read = tools.get("session_read");
    const recent = await read.execute({ sessionID: session.id, mode: "recent", limit: 2 }, execution());
    expect(recent.content).toContain("last question");
    expect(recent.content.indexOf("last question")).toBeLessThan(recent.content.indexOf("last answer"));
    expect(recent.content).not.toContain("first question");
    expect(recent.metadata).toMatchObject({ count: 2, total: 4, source: "active-context" });
    const slice = await read.execute({ sessionID: session.id, mode: "slice", limit: 1 }, execution());
    expect(slice.content).toContain("first question");
    expect(slice.content).not.toContain("last question");
    const descending = await read.execute({ sessionID: session.id, mode: "slice", from: 1, limit: 2, type: "user" }, execution());
    expect(descending.content).toContain(ACTIVE_CONTEXT_NOTICE);
    expect(descending.content.indexOf("first question")).toBeLessThan(descending.content.indexOf("last question"));
    expect(descending.content).not.toContain("answer");
    const summary = await read.execute({ sessionID: session.id, mode: "summary", limit: 1 }, execution());
    expect(summary.content).toContain("last answer");
    expect(get).toHaveBeenCalledWith({ sessionID: session.id });
    expect(active).toHaveBeenCalledWith({ sessionID: session.id });
    if (state === "offline") expect(globalThis.fetch).toHaveBeenCalled();
    else expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test.each([[[]], [{ data: [], cursor: {} }], [undefined]])("empty native session list returns immediately after HTTP is unavailable: %j", async value => {
    const http = spyOn(OpenCodeClient.prototype, "listSessions").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    const list = mock(async () => value);
    Object.assign(context.session, { list });
    const result = await tools.get("session_list").execute({}, execution());
    expect(result.content).toContain("[]\n\nPagination: {}");
    expect(result.content).toContain(ACTIVE_CONTEXT_NOTICE);
    expect(result.metadata).toMatchObject({ count: 0, cursor: {}, source: "active-context" });
    expect(list).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(1);
  }, 1_000);

  test.each(["summary", "recent", "slice"])("missing native session returns immediately in %s mode", async mode => {
    const http = spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    const active = mock(async () => []);
    for (const value of [undefined, null, { data: undefined }, { data: null }]) {
      Object.assign(context.session, { get: async () => value, context: active });
      const result = await tools.get("session_read").execute({ sessionID: "ses-missing", mode }, execution());
      expect(result).toEqual({
        content: `Session not found: ses-missing\n${ACTIVE_CONTEXT_NOTICE}`,
        metadata: { sessionID: "ses-missing", mode, count: 0, available: false },
      });
    }
    expect(active).not.toHaveBeenCalled();
    expect(http).toHaveBeenCalledTimes(4);
  }, 1_000);

  test.each(["summary", "recent", "slice"])("empty native session returns a header immediately in %s mode", async mode => {
    const get = spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("HTTP must not run"));
    const active = spyOn(OpenCodeClient.prototype, "getSessionContext").mockRejectedValue(new Error("HTTP must not run"));
    const page = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    for (const value of [[], { data: [] }, undefined]) {
      Object.assign(context.session, { get: async () => session, context: async () => value });
      const result = await tools.get("session_read").execute({ sessionID: session.id, mode }, execution());
      expect(result.content).toContain(`# ${session.title}`);
      expect(result.content).toContain("No conversation messages in this session.");
      expect(result.content).toContain(ACTIVE_CONTEXT_NOTICE);
      expect(result.metadata).toMatchObject({ sessionID: session.id, title: session.title, mode, count: 0 });
    }
    expect(get).toHaveBeenCalledTimes(3);
    expect(active).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
  }, 1_000);

  test.each(["summary", "recent", "slice"])("missing HTTP session is authoritative in %s mode", async mode => {
    const http = spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: undefined } as any);
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { get: async () => { throw new Error("native unavailable"); } });
    const result = await tools.get("session_read").execute({ sessionID: "ses-missing", mode }, execution());
    expect(result.content).toBe("Session not found: ses-missing");
    expect(result.metadata).toEqual({ sessionID: "ses-missing", mode, count: 0, available: false });
    expect(http).toHaveBeenCalledTimes(1);
  });

  test("failed native and HTTP session lookups return a readable result", async () => {
    spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("offline"));
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { get: async () => { throw new Error("native unavailable"); } });
    const result = await tools.get("session_read").execute({ sessionID: "ses-missing", mode: "summary" }, execution());
    expect(result.metadata).toMatchObject({ count: 0, available: false });
  });

  test("HTTP list succeeds first and reports unavailable if both HTTP and native fail", async () => {
    const http = spyOn(OpenCodeClient.prototype, "listSessions").mockResolvedValue({ data: [], cursor: {} });
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { list: async () => { throw new Error("native unavailable"); } });
    const tool = tools.get("session_list");
    expect((await tool.execute({}, execution())).metadata).toMatchObject({ count: 0, cursor: {}, source: "history" });
    expect(http).toHaveBeenCalledTimes(1);
    http.mockRejectedValue(new Error("offline"));
    const result = await tool.execute({}, execution());
    expect(result.content).toContain("Session list is unavailable");
    expect(result.metadata).toMatchObject({ count: 0, available: false });
  });

  test.each(["summary", "recent", "slice"])("empty HTTP messages return a header in %s mode", async mode => {
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    spyOn(OpenCodeClient.prototype, "getSessionContext").mockResolvedValue({ data: [] });
    spyOn(OpenCodeClient.prototype, "getSessionMessages").mockResolvedValue({ data: [], cursor: {} });
    const { tools, context } = await register(sessionPlugin);
    context.session.context = async () => { throw new Error("native unavailable"); };
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode }, execution());
    expect(result.content).toContain(`# ${session.title}`);
    expect(result.content).toContain("No conversation messages in this session.");
    expect(result.metadata).toMatchObject({ count: 0, mode });
  });

  test("the real SDK SessionDomain has context but no native diff method", async () => {
    const source = await readFile(Bun.resolveSync("@opencode/plugin/promise/session", import.meta.dir).replace(/\.js$/, ".d.ts"), "utf8");
    const domain = source.slice(source.indexOf("export type SessionDomain ="));
    expect(domain).toContain('"context"');
    expect(domain).not.toContain('"diff"');
  });

  test("diff HTTP failure lists input-derived files without a native diff method", async () => {
    mockHistory();
    spyOn(OpenCodeClient.prototype, "getSessionDiff").mockRejectedValue(new Error("offline"));
    const { tools, context } = await register(sessionPlugin);
    expect(context.session).not.toHaveProperty("diff");
    for (const [name, input] of [["session_diff", { sessionID: session.id }], ["session_read", { sessionID: session.id, mode: "diff" }]] as const) {
      const result = await tools.get(name).execute(input, execution());
      expect(result.content).toContain("Snapshot diffs are unavailable");
      expect(result.content).toContain("## Files written or edited");
      expect(result.content).toContain("/workspace/a.ts");
      expect(result.metadata.available).toBe(false);
    }
  });

  test("unavailable native message context returns a readable result", async () => {
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    spyOn(OpenCodeClient.prototype, "getSessionMessages").mockRejectedValue(new Error("offline"));
    const { tools, context } = await register(sessionPlugin);
    context.session.context = async () => { throw new Error("context unavailable"); };
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "recent" }, execution());
    expect(result.content).toContain("Session messages are unavailable");
    expect(result.metadata.available).toBe(false);
  });

  test("empty unwrapped native context is a valid standalone read", async () => {
    spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("offline"));
    spyOn(OpenCodeClient.prototype, "getSessionMessages").mockRejectedValue(new Error("offline"));
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { get: async () => session });
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "recent" }, execution());
    expect(result.content).toContain("No conversation messages in this session.");
    expect(result.metadata).toMatchObject({ count: 0, source: "active-context" });
  });

  test("cancellation is not swallowed by standalone fallbacks", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { list: async () => [], get: async () => session });
    for (const [name, input] of [["session_list", {}], ["session_read", { sessionID: session.id, mode: "recent" }], ["session_diff", { sessionID: session.id }]] as const) {
      await expect(tools.get(name).execute(input, execution(controller.signal))).rejects.toBe(reason);
    }
  });

  test("registrations, full-history counts and list-only opaque cursors remain accurate", async () => {
    const list = spyOn(OpenCodeClient.prototype, "listSessions").mockResolvedValue({ data: [session], cursor });
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    spyOn(OpenCodeClient.prototype, "getSessionContext").mockResolvedValue({ data: [{ role: "user", text: "first" }, { role: "assistant", text: "second" }] });
    const messages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockResolvedValue({ data: [{ role: "user", text: "hello" }], cursor });
    const { tools, context } = await register(sessionPlugin);
    context.session.context = async () => { throw new Error("native unavailable"); };
    expect([...tools.keys()]).toEqual(["session_list", "session_read", "session_diff"]);
    for (const tool of tools.values()) expect(tool.options).toEqual({ codemode: false });
    const ctx = execution();
    const result = await tools.get("session_list").execute({ search: "test", cursor: "opaque+/=" }, ctx);
    expect(result.metadata).toMatchObject({ count: 1, search: "test", cursor, source: "history" });
    expect(result.content).toContain(JSON.stringify(cursor));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ cursor: "opaque+/=", order: undefined, directory: undefined }), ctx.signal);
    const summary = await tools.get("session_read").execute({ sessionID: session.id, mode: "summary", limit: 1 }, ctx);
    expect(summary.metadata).toMatchObject({ sessionID: session.id, title: session.title, mode: "summary", count: 1, total: 1, source: "history" });
    const page = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", from: 1 }, ctx);
    expect(page.metadata).toMatchObject({ sessionID: session.id, title: session.title, mode: "slice", count: 1, total: 1, source: "history" });
    expect(page.content).toContain("Messages #1–#1 of 1");
    expect(page.metadata).not.toHaveProperty("cursor");
    expect(messages).toHaveBeenCalledWith({ sessionID: session.id, limit: 200, order: "asc" }, ctx.signal);
  });

  test("diff and read(diff) count actual selected files; unknown line counts stay unknown", async () => {
    mockHistory();
    spyOn(OpenCodeClient.prototype, "getSessionDiff").mockResolvedValue({ data: [
      { file: "a.ts", before: "old", after: "new", additions: 2, deletions: 1 },
      { file: "b.ts", before: "", after: "new" },
    ] });
    const { tools } = await register(sessionPlugin);
    const diff = await tools.get("session_diff").execute({ sessionID: session.id, file: "a.ts" }, execution());
    expect(diff.metadata).toMatchObject({ sessionID: session.id, files: 1, additions: 2, deletions: 1 });
    const read = await tools.get("session_read").execute({ sessionID: session.id, mode: "diff" }, execution());
    expect(read.metadata).toMatchObject({ sessionID: session.id, mode: "diff", count: 2, files: 2 });
    expect(read.metadata).not.toHaveProperty("additions");
    expect(read.metadata).not.toHaveProperty("deletions");
    expect(read.content).toContain("b.ts");
    const empty = await tools.get("session_diff").execute({ sessionID: session.id, file: "missing" }, execution());
    expect(empty.metadata).toMatchObject({ sessionID: session.id, files: 0, additions: 0, deletions: 0 });
  });

  test.each([
    ["http://localhost:12346/base", "p:a ss/字"],
    ["https://localhost", password],
    ["http://[::1]:12347", ""],
    ["http://127.0.0.1:12348", undefined],
  ])("client uses advertised URL and optional basic credentials: %#", async (baseURL, credential) => {
    const stateDirectory = path.join(workspace, "service-state");
    await writeRegistration(stateDirectory, "service.json", { url: baseURL, password: credential });
    let requested = false;
    const client = new OpenCodeClient({ stateDirectory, fetch: (async (url, options) => {
      requested = true;
      expect(String(url)).toBe(new URL("/api/session/ses%2B%2F%3D/diff", baseURL).href);
      const headers = new Headers(options?.headers);
      expect(headers.get("Authorization")).toBe(credential === undefined ? null : `Basic ${Buffer.from(`opencode:${credential}`).toString("base64")}`);
      expect(options?.redirect).toBe("error");
      return Response.json({ data: [] });
    }) as typeof fetch });
    expect(await client.getSessionDiff({ sessionID: "ses+/=" })).toEqual({ data: [] });
    expect(requested).toBe(true);
  });

  test("client reloads registration URL and password after service restart", async () => {
    const stateDirectory = path.join(workspace, "service-state");
    const requests: { url: string; authorization: string | null }[] = [];
    const client = new OpenCodeClient({ stateDirectory, fetch: (async (url, options) => {
      requests.push({ url: String(url), authorization: new Headers(options?.headers).get("Authorization") });
      return Response.json({ data: [] });
    }) as typeof fetch });
    for (const [port, credential] of [[12345, "first"], [12346, "second"]] as const) {
      await writeRegistration(stateDirectory, "service.json", { url: `http://localhost:${port}`, password: credential });
      await client.getSessionDiff({ sessionID: session.id });
      expect(requests.at(-1)).toEqual({
        url: `http://localhost:${port}/api/session/${session.id}/diff`,
        authorization: `Basic ${Buffer.from(`opencode:${credential}`).toString("base64")}`,
      });
    }
  });

  test("host channel registration enables authenticated HTTP diffs and full-history pagination without native diff", async () => {
    const requests: URL[] = [];
    const diffs = [{ file: "a.ts", before: "old", after: "new", additions: 1, deletions: 1 }];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      if (request.headers.get("authorization") !== `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`) return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/api/session") return Response.json({ data: [session], cursor });
      if (url.pathname.endsWith("/diff")) return Response.json({ data: diffs });
      if (url.pathname.endsWith("/message")) return Response.json({ data: [{ id: "msg_first", role: "user", text: "historic question" }, { id: "msg_last", role: "assistant", text: "historic answer" }], cursor });
      if (url.pathname.endsWith("/context")) return Response.json({ data: [{ role: "user", text: "active question" }] });
      if (url.pathname === `/api/session/${session.id}`) return Response.json({ data: session });
      return new Response("Not found", { status: 404 });
    } });
    try {
      const directory = path.join(process.env.XDG_STATE_HOME!, "opencode");
      await writeRegistration(directory, "service-local.json", { url: `http://localhost:${server.port}` });
      await writeRegistration(directory, "service-prod.json", { password: "wrong-channel" });
      process.env.OPENCODE_CHANNEL = "prod"; // The host's embedded app.channel, not a build-time env var, selects the service.
      const configDirectory = path.join(process.env.XDG_CONFIG_HOME!, "opencode");
      await mkdir(configDirectory, { recursive: true });
      await writeFile(path.join(configDirectory, "service.json"), JSON.stringify({ port: 49375, password: "stale" }));
      const { tools, context } = await register(sessionPlugin, "local");
      context.session.context = async () => { throw new Error("native context unavailable"); };
      expect(context.session).not.toHaveProperty("diff");
      const listed = await tools.get("session_list").execute({ search: "history", cursor: "opaque+/=" }, execution());
      expect(listed.metadata).toMatchObject({ count: 1, cursor });
      const diff = await tools.get("session_diff").execute({ sessionID: session.id, file: "a.ts" }, execution());
      expect(diff.content).toContain("a.ts");
      expect(diff.metadata).toMatchObject({ sessionID: session.id, files: 1, additions: 1, deletions: 1 });
      const readDiff = await tools.get("session_read").execute({ sessionID: session.id, mode: "diff" }, execution());
      expect(readDiff.metadata).toMatchObject({ count: 1, files: 1, mode: "diff" });
      const page = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", from: 1, limit: 2, type: "user" }, execution());
      expect(page.content).toContain("historic question");
      expect(page.content).not.toContain("historic answer");
      expect(page.content).not.toContain("active context only");
      expect(page.metadata).toMatchObject({ sessionID: session.id, title: session.title, mode: "slice", count: 1, total: 2, source: "history" });
      const request = requests.find(url => url.pathname.endsWith("/message"))!;
      expect(request.searchParams.get("cursor")).toBeNull();
      expect(request.searchParams.get("order")).toBe("asc");
      expect(request.searchParams.get("limit")).toBe("200");
      expect(request.searchParams.get("type")).toBeNull();
      const summary = await tools.get("session_read").execute({ sessionID: session.id, mode: "summary" }, execution());
      expect(summary.content).toContain("historic question");
      expect(summary.content).not.toContain("active question");
      expect(summary.metadata.count).toBe(2);
      expect(requests.every(url => url.port === String(server.port))).toBe(true);
    } finally { await server.stop(true); }
  });

  test("local service preserves cursor encoding, errors redact credentials, abort reaches HTTP", async () => {
    const stateDirectory = path.join(workspace, "service-state");
    const requests: URL[] = [];
    let fail = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push(new URL(request.url));
      if (request.headers.get("authorization") !== `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`) return new Response("Unauthorized", { status: 401 });
      if (fail) return new Response(`failure ${password} ${Buffer.from(`opencode:${password}`).toString("base64")}`, { status: 401 });
      return Response.json({ data: [session], cursor });
    } });
    try {
      await writeRegistration(stateDirectory, "service.json", { url: `http://127.0.0.1:${server.port}` });
      const client = new OpenCodeClient({ stateDirectory });
      const result = await client.listSessions({ cursor: "opaque+/=", search: "a & b" });
      expect(result.cursor).toEqual(cursor);
      expect(requests[0].searchParams.get("cursor")).toBe("opaque+/=");
      expect(requests[0].searchParams.get("search")).toBe("a & b");
      fail = true;
      try { await client.listSessions(); throw new Error("expected failure"); } catch (error) {
        expect((error as Error).message).toContain("HTTP 401");
        expect((error as Error).message).not.toContain(password);
        expect((error as Error).message).not.toContain(Buffer.from(`opencode:${password}`).toString("base64"));
      }
      const controller = new AbortController();
      const reason = new Error("cancel session request");
      const aborted = new OpenCodeClient({ stateDirectory, fetch: (async (_url, options) => {
        expect(options?.signal?.aborted).toBe(false);
        controller.abort(reason);
        expect(options?.signal?.aborted).toBe(true);
        throw reason;
      }) as typeof fetch });
      await expect(aborted.listSessions({}, controller.signal)).rejects.toBe(reason);
    } finally { await server.stop(true); }
  });

  test("HTTP is used before native list, get and active context", async () => {
    mockHistory();
    const { tools, context } = await register(sessionPlugin);
    const nativeList = mock(async () => { throw new Error("native must not run"); });
    const nativeGet = mock(async () => { throw new Error("native must not run"); });
    const nativeContext = mock(async () => { throw new Error("native must not run"); });
    Object.assign(context.session, { list: nativeList, get: nativeGet, context: nativeContext });
    expect((await tools.get("session_list").execute({}, execution())).metadata.source).toBe("history");
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", limit: 1 }, execution());
    expect(result.content).toContain("Restore this project.");
    expect(result.metadata.source).toBe("history");
    expect(nativeList).not.toHaveBeenCalled();
    expect(nativeGet).not.toHaveBeenCalled();
    expect(nativeContext).not.toHaveBeenCalled();
  });

  test.each(["list", "get", "context"])("hung native %s is bounded by an injectable timeout", async method => {
    globalThis.fetch = mock(async () => { throw new Error("missing registration must not fetch"); }) as typeof fetch;
    const { tools, context } = await register(createSessionReaderPlugin({ nativeTimeoutMs: 10 }));
    const hung = mock(() => new Promise(() => {}));
    Object.assign(context.session, { list: async () => [], get: async () => session, context: async () => [] });
    Object.assign(context.session, { [method]: hung });
    const started = performance.now();
    const result = await tools.get(method === "list" ? "session_list" : "session_read").execute(method === "list" ? {} : { sessionID: session.id, mode: "recent" }, execution());
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.metadata.available).toBe(false);
    expect(result.content).toContain("timed out after 10ms");
    expect(hung).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 1_000);

  test("cancellation interrupts a running native call", async () => {
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { get: () => new Promise(() => {}) });
    const controller = new AbortController();
    const reason = new Error("cancel hung native");
    const timer = setTimeout(() => controller.abort(reason), 10);
    try { await expect(tools.get("session_read").execute({ sessionID: session.id }, execution(controller.signal))).rejects.toBe(reason); }
    finally { clearTimeout(timer); }
  }, 1_000);

  test("full-history loader follows opaque next cursors and stops on a short page", async () => {
    const messages = Array.from({ length: 405 }, (_, index) => ({ id: `msg_${index + 1}`, type: "user", text: `prompt-${index + 1}` }));
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    let page = 0;
    const pages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockImplementation(async () => {
      const start = page++ * 200;
      return { data: messages.slice(start, start + 200), cursor: { next: ["opaque+/=first", "opaque-second", "ignored-short"][page - 1] } };
    });
    const { tools, context } = await register(sessionPlugin);
    const active = mock(async () => []);
    context.session.context = active;
    const ctx = execution();
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", from: 199, limit: 6 }, ctx);
    expect(result.metadata).toMatchObject({ total: 405, count: 6, source: "history" });
    expect(result.content).toContain("Messages #199–#204 of 405");
    expect(pages).toHaveBeenCalledTimes(3);
    expect(pages.mock.calls[0]).toEqual([{ sessionID: session.id, limit: 200, order: "asc" }, ctx.signal]);
    expect(pages.mock.calls[1]).toEqual([{ sessionID: session.id, limit: 200, cursor: "opaque+/=first" }, ctx.signal]);
    expect(pages.mock.calls[2]).toEqual([{ sessionID: session.id, limit: 200, cursor: "opaque-second" }, ctx.signal]);
    expect(active).not.toHaveBeenCalled();
  });

  test("history cache retains the last three sessions and invalidates on updated time", async () => {
    const revisions = new Map<string, number>();
    spyOn(OpenCodeClient.prototype, "getSession").mockImplementation(async id => ({ data: { ...session, id, time: { ...session.time, updated: revisions.get(id) ?? 1 } } }));
    const pages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockImplementation(async input => ({ data: [{ type: "user", text: input.sessionID }], cursor: {} }));
    const { tools } = await register(sessionPlugin);
    const read = async (id: string) => tools.get("session_read").execute({ sessionID: id, mode: "recent" }, execution());
    for (const id of ["A", "B", "C", "A", "D", "B"]) await read(id);
    expect(pages).toHaveBeenCalledTimes(5);
    revisions.set("A", 2);
    await read("A");
    expect(pages).toHaveBeenCalledTimes(6);
  });

  test("history loading honours cancellation between pages", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel history load");
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    const pages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockImplementation(async () => {
      controller.abort(reason);
      return { data: Array.from({ length: 200 }, () => ({ type: "user", text: "prompt" })), cursor: { next: "next" } };
    });
    const { tools } = await register(sessionPlugin);
    await expect(tools.get("session_read").execute({ sessionID: session.id }, execution(controller.signal))).rejects.toBe(reason);
    expect(pages).toHaveBeenCalledTimes(1);
  });

  test("summary contains every resume section and reports how the session ended", async () => {
    const { list } = mockHistory();
    const { tools } = await register(sessionPlugin);
    const ctx = execution();
    const result = await tools.get("session_read").execute({ sessionID: session.id }, ctx);
    const text = result.content;
    expect(result.metadata).toMatchObject({ total: 16, count: 16, source: "history", mode: "summary" });
    const sections = ["## User prompts", "## Latest todo list (#12)", "## Questions answered", "## Subagents", "## Files written or edited", "## Running summaries", "## Last steps (#5–#16)", "## Read more"];
    for (const section of sections) expect(text).toContain(section);
    for (let index = 1; index < sections.length; index++) expect(text.indexOf(sections[index - 1]!)).toBeLessThan(text.indexOf(sections[index]!));
    for (const prompt of historyFixture().filter(message => message.type === "user")) expect(text).toContain(prompt.text);
    for (const item of ["[x] Completed task", "[~] Current task", "[ ] Pending task", "[-] Cancelled task", "Which color?", '["blue"]', "Run tests?", '["yes"]', "ses_child1", "Blue child", "dispatch #6", "result #7", "/workspace/a.ts — 2 calls, last #8", "/workspace/b.ts", "/workspace/c.ts", "m00001–m00003 Orientation", "m00004–m00008 Decision", "m00009–m00012", "Newest durable summary: preserve blue.", "Legacy plain summary string.", "Native compaction state: keep blue.", "Active context starts at #10", "finish=error", "Transport timed out", "idle #16 outcome=failed", "Unfinished tool calls in last assistant #15: [2] shell running", "fixture-model", "Cost: $1.25"]) expect(text).toContain(item);
    expect(text.slice(text.indexOf("## Latest todo list"), text.indexOf("## Questions answered"))).not.toContain("Unfinished replacement must not win");
    expect(text).toContain(`Message: session_read({"sessionID":"${session.id}","mode":"message","message":16})`);
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(list).toHaveBeenCalledWith({ parentID: session.id, limit: 200 }, ctx.signal);
  });

  test("slice uses global from/limit handles before filters; recent stays chronological", async () => {
    mockHistory();
    const { tools } = await register(sessionPlugin);
    const read = tools.get("session_read");
    const slice = await read.execute({ sessionID: session.id, mode: "slice", from: 3, limit: 2 }, execution());
    expect(slice.content).toContain("Messages #3–#4 of 16");
    expect(slice.content).not.toContain("Restore this project.");
    expect(slice.content).not.toContain("Which color?");
    const filtered = await read.execute({ sessionID: session.id, mode: "slice", from: 2, limit: 2, type: "user" }, execution());
    expect(filtered.content).toContain("Messages #4–#11 of 16");
    expect(filtered.content).toContain("Continue exactly from here.");
    const recent = await read.execute({ sessionID: session.id, mode: "recent", limit: 3 }, execution());
    expect(recent.content).toContain("Messages #14–#16 of 16");
    expect(recent.content.indexOf("## #14")).toBeLessThan(recent.content.indexOf("## #15"));
    expect(recent.content.indexOf("## #15")).toBeLessThan(recent.content.indexOf("## #16"));
    expect(recent.content).toContain("[Assistant error] provider.transport: Transport timed out");
    expect(recent.content).not.toContain("Final late reasoning.");
  });

  test("full rendering includes reasoning, failed calls and both ends of long outputs", async () => {
    mockHistory();
    const { tools } = await register(sessionPlugin);
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "recent", limit: 8, detail: "full" }, execution());
    for (const item of ["Late reasoning keyword: rationale.", "Final late reasoning.", '"command": "do-late-work"', "BEGIN_MARKER-", "-END_MARKER needle-haystack", "chars omitted] …", '"message":14,"part":1', "[Tool error] boom"]) expect(result.content).toContain(item);
    expect(result.content.length).toBeLessThanOrEqual(20_000);
  });

  test("tool filter keeps only matching calls and does not apply per-payload truncation", async () => {
    const input = "I".repeat(7_000);
    const output = "O".repeat(8_000);
    mockHistory([{ type: "assistant", content: [{ type: "reasoning", text: "excluded reasoning" }, call("compress", { summary: input }, output), call("read", { path: "excluded-file" }, "excluded-output"), { type: "text", text: "excluded text" }] }]);
    const { tools } = await register(sessionPlugin);
    const result = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", tool: "compress", maxChars: 60_000 }, execution());
    expect(result.metadata.count).toBe(1);
    expect(result.content).toContain("### [2] compress completed");
    expect(result.content).toContain(input);
    expect(result.content).toContain(output);
    expect(result.content).not.toContain("excluded");
    expect(result.content).not.toContain("chars omitted");
  });

  test("message accepts number, #handle and ID; part/offset pages only that output", async () => {
    mockHistory();
    const { tools } = await register(sessionPlugin);
    const read = tools.get("session_read");
    const all = await read.execute({ sessionID: session.id, mode: "message", message: 14 }, execution());
    expect(all.content).toContain("An unrelated assistant text part.");
    expect(all.content).toContain("BEGIN_MARKER-");
    for (const message of ["#14", "msg_fixture_14"]) {
      const result = await read.execute({ sessionID: session.id, mode: "message", message, part: 1, offset: 12_000 }, execution());
      expect(result.metadata.message).toBe(14);
      expect(result.content).toContain("offset 12000");
      expect(result.content).toContain("-END_MARKER needle-haystack");
      expect(result.content).not.toContain("BEGIN_MARKER-");
      expect(result.content).not.toContain("An unrelated assistant text part.");
    }
    const first = await read.execute({ sessionID: session.id, mode: "message", message: 14, part: 1, maxChars: 2_000 }, execution());
    expect(first.content.length).toBeLessThanOrEqual(2_000);
    expect(first.content).toContain("remaining). Continue: session_read(");
    const continuation = JSON.parse(first.content.match(/Continue: session_read\((\{[^\n]+\})\)/)![1]!);
    expect(continuation).toMatchObject({ sessionID: session.id, mode: "message", message: 14, part: 1, maxChars: 2_000 });
    expect(continuation.offset).toBeGreaterThan(0);
    const next = await read.execute(continuation, execution());
    expect(next.content).toContain(`offset ${continuation.offset}`);
    expect(next.content.length).toBeLessThanOrEqual(2_000);
  });

  test("search finds tool outputs, inputs, reasoning and synthetic results across history", async () => {
    mockHistory();
    const { tools } = await register(sessionPlugin);
    const read = tools.get("session_read");
    const output = await read.execute({ sessionID: session.id, mode: "search", query: "SPECTRUM", tool: "grep" }, execution());
    expect(output.metadata).toMatchObject({ hits: 1, count: 1, total: 16 });
    expect(output.content).toContain("#5 assistant [3] grep.output");
    expect(output.content).toContain("tool-output-only keyword: spectrum");
    const input = await read.execute({ sessionID: session.id, mode: "search", query: "full child brief", tool: "subagent" }, execution());
    expect(input.content).toContain("#6 assistant [1] subagent.input");
    const reasoning = await read.execute({ sessionID: session.id, mode: "search", query: "rationale", type: "assistant" }, execution());
    expect(reasoning.content).toContain("#13 assistant [1] reasoning");
    const result = await read.execute({ sessionID: session.id, mode: "search", query: "suite passed", type: "synthetic" }, execution());
    expect(result.content).toContain("#7 synthetic text");
  });

  test("message type is an enum; cursor/order and invalid combinations return readable errors", async () => {
    expect(sessionReadInput.safeParse({ sessionID: session.id, type: "text" }).success).toBe(false);
    expect(sessionReadInput.safeParse({ sessionID: session.id, type: "assistant" }).success).toBe(true);
    expect(sessionReadInput.shape).not.toHaveProperty("cursor");
    expect(sessionReadInput.shape).not.toHaveProperty("order");
    const get = spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("validation must happen first"));
    const { tools } = await register(sessionPlugin);
    for (const input of [{ type: "text" }, { mode: "message" }, { mode: "message", message: 1, offset: 1 }, { mode: "slice", message: 1 }, { mode: "search" }, { mode: "summary", from: 2 }, { mode: "summary", tool: "compress" }, { cursor: "old-cursor" }, { order: "desc" }, { mode: "search", query: " " }]) {
      const result = await tools.get("session_read").execute({ sessionID: session.id, ...input }, execution());
      expect(result.metadata.available).toBe(false);
      expect(result.content.length).toBeLessThan(600);
    }
    expect(get).not.toHaveBeenCalled();
  });

  test("output budget stops at a message boundary with an executable continuation", async () => {
    mockHistory(Array.from({ length: 40 }, (_, index) => ({ type: "user", text: `PROMPT-${index + 1} ${"word ".repeat(160)}` })));
    const { tools } = await register(sessionPlugin);
    const read = tools.get("session_read");
    const result = await read.execute({ sessionID: session.id, mode: "slice", from: 1, limit: 40, maxChars: 2_000 }, execution());
    expect(result.content.length).toBeLessThanOrEqual(2_000);
    expect(result.content).toContain(`Stopped at #${result.metadata.stoppedAt} of #1–#40 (output budget). Continue: session_read(`);
    const continuation = JSON.parse(result.content.match(/Continue: session_read\((\{[^\n]+\})\)/)![1]!);
    expect(continuation).toMatchObject({ sessionID: session.id, mode: "slice", from: result.metadata.stoppedAt, maxChars: 2_000 });
    expect(result.content).not.toContain(`PROMPT-${continuation.from} `);
    const next = await read.execute(continuation, execution());
    expect(next.content).toContain(`## #${continuation.from} user`);
    expect(next.content.length).toBeLessThanOrEqual(2_000);
  });

  test("empty whole-session diffs list written files for both tools", async () => {
    mockHistory();
    const diffs = spyOn(OpenCodeClient.prototype, "getSessionDiff").mockResolvedValue({ data: [] });
    const { tools } = await register(sessionPlugin);
    const ctx = execution();
    for (const [name, input] of [["session_diff", { sessionID: session.id }], ["session_read", { sessionID: session.id, mode: "diff" }]] as const) {
      const result = await tools.get(name).execute(input, ctx);
      expect(result.content).toContain("Snapshot diffs are not recorded for this session.");
      expect(result.content).toContain("/workspace/a.ts — 2 calls, last #8");
      expect(result.content).toContain("/workspace/c.ts");
    }
    expect(diffs).toHaveBeenCalledWith({ sessionID: session.id, from: "msg_fixture_1", to: "msg_fixture_11" }, ctx.signal);
  });

  test("session_list passes parentID through HTTP and emits ISO row timestamps", async () => {
    const requests: URL[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push(new URL(request.url));
      return Response.json({ data: [{ ...session, id: "ses_child1", parentID: session.id }], cursor });
    } });
    try {
      await writeRegistration(path.join(process.env.XDG_STATE_HOME!, "opencode"), "service-prod.json", { url: `http://127.0.0.1:${server.port}` });
      const { tools, context } = await register(sessionPlugin);
      const native = mock(async () => { throw new Error("native list must not run"); });
      Object.assign(context.session, { list: native });
      const result = await tools.get("session_list").execute({ parentID: session.id, limit: 200 }, execution());
      expect(requests[0]!.searchParams.get("parentID")).toBe(session.id);
      expect(requests[0]!.searchParams.get("directory")).toBeNull();
      expect(requests[0]!.searchParams.get("limit")).toBe("200");
      const rows = JSON.parse(result.content.split("\n\nPagination:")[0]);
      expect(rows[0]).toMatchObject({ id: "ses_child1", parentID: session.id, agent: "orchestrator", outcome: "failed", directory: "/workspace", created: new Date(session.time.created).toISOString(), updated: new Date(session.time.updated).toISOString() });
      await tools.get("session_list").execute({ parentID: "null", directory: "/explicit", cursor: "opaque+/=" }, execution());
      expect(requests[1]!.searchParams.get("parentID")).toBe("null");
      expect(requests[1]!.searchParams.get("directory")).toBe("/explicit");
      expect(requests[1]!.searchParams.get("order")).toBeNull();
      expect(native).not.toHaveBeenCalled();
    } finally { await server.stop(true); }
  });

  test("an HTTP not-found response does not fall back to a different native view", async () => {
    await writeRegistration(path.join(process.env.XDG_STATE_HOME!, "opencode"), "service-prod.json");
    globalThis.fetch = mock(async () => new Response("missing", { status: 404 })) as typeof fetch;
    const { tools, context } = await register(sessionPlugin);
    const native = mock(async () => session);
    Object.assign(context.session, { get: native });
    const result = await tools.get("session_read").execute({ sessionID: session.id }, execution());
    expect(result.content).toBe(`Session not found: ${session.id}`);
    expect(native).not.toHaveBeenCalled();
  });

  test("message-page HTTP timeout has a per-call override", async () => {
    const stateDirectory = path.join(workspace, "service-state");
    await writeRegistration(stateDirectory);
    const client = new OpenCodeClient({ stateDirectory, timeoutMs: 1_000, fetch: ((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    })) as typeof fetch });
    await expect(client.getSessionMessages({ sessionID: session.id, limit: 200 }, undefined, 10)).rejects.toThrow("timed out after 10ms");
  });

  test("HTTP fallback times out after the default 2500ms instead of hanging", async () => {
    const stateDirectory = path.join(workspace, "service-state");
    await writeRegistration(stateDirectory);
    const client = new OpenCodeClient({ stateDirectory, fetch: ((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    })) as typeof fetch });
    await expect(client.getSession("ses-missing")).rejects.toThrow("timed out after 2500ms");
  }, 4_000);

  // The host stores tool metadata as Record<string, Json>. One undefined value fails that schema, the result is
  // dropped ("Tool result missing") and the call stays "running" — what session_list did without `search`.
  function isJson(value: unknown): boolean {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJson);
    return typeof value === "object" && Object.values(value as object).every(isJson);
  }

  test("every tool result carries JSON-only metadata, also when optional inputs are absent", async () => {
    mockHistory();
    spyOn(OpenCodeClient.prototype, "getSessionDiff").mockResolvedValue({ data: [] });
    const { tools } = await register(sessionPlugin);
    const id = session.id;
    const calls: [string, Record<string, unknown>][] = [
      ["session_list", {}], ["session_list", { all: true, limit: 3 }], ["session_list", { search: "blue" }], ["session_list", { parentID: id }],
      ["session_read", { sessionID: id }], ["session_read", { sessionID: id, mode: "recent" }], ["session_read", { sessionID: id, mode: "slice", from: 2, tool: "compress" }],
      ["session_read", { sessionID: id, mode: "message", message: 14, part: 1 }], ["session_read", { sessionID: id, mode: "search", query: "blue" }], ["session_read", { sessionID: id, mode: "diff" }],
      ["session_read", { sessionID: id, mode: "search" }], ["session_read", { sessionID: id, cursor: "x" }], ["session_diff", { sessionID: id }],
    ];
    for (const [name, input] of calls) {
      const result = await tools.get(name).execute(input, execution());
      expect({ name, input, content: result.content.length > 0, json: isJson(result.metadata) }).toEqual({ name, input, content: true, json: true });
    }
    const listed = await tools.get("session_list").execute({ all: true }, execution());
    expect(Object.keys(listed.metadata).sort()).toEqual(["count", "cursor", "source"]);
  });

  test("native fallback results stay JSON-only when the native cursor has undefined ends", async () => {
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { list: async () => ({ data: [session], cursor: { previous: undefined, next: undefined } }) });
    const result = await tools.get("session_list").execute({ all: true }, execution());
    expect(result.metadata).toMatchObject({ count: 1, source: "active-context" });
    expect(isJson(result.metadata)).toBe(true);
  });

  test("inline base64 payloads are reduced to their media type and size everywhere", async () => {
    const blob = "QUJD".repeat(5_000);
    const messages = [
      { type: "user", text: "look at the picture" },
      { type: "assistant", content: [call("read", { path: "/workspace/shot.png" }, `Image read successfully\n{"type":"file","uri":"data:image/png;base64,${blob}"}\ntrailing-note`)] },
    ];
    mockHistory(messages.map((message, index) => ({ id: `msg_bin_${index + 1}`, time: { created: session.time.created + index }, ...message })));
    const { tools } = await register(sessionPlugin);
    const read = (input: Record<string, unknown>) => tools.get("session_read").execute({ sessionID: session.id, ...input }, execution());
    const page = (await read({ mode: "message", message: 2, part: 1 })).content;
    expect(page).toContain("data:image/png;base64,[20000 base64 chars omitted]");
    expect(page).toContain("trailing-note");
    expect(page).not.toContain("QUJDQUJD");
    expect((await read({ mode: "recent", detail: "full" })).content).not.toContain("QUJDQUJD");
    expect((await read({ mode: "recent" })).content).toMatch(/read completed \/workspace\/shot\.png → \d{2,3} chars/);
    expect((await read({ mode: "search", query: "QUJDQUJD" })).metadata).toMatchObject({ hits: 0 });
  });

  test("brief listings explain the drill-down once instead of on every tool line", async () => {
    mockHistory();
    const { tools } = await register(sessionPlugin);
    const text = (await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", from: 1, limit: 16 }, execution())).content;
    expect(text.match(/Any part in full: session_read\(/g)).toHaveLength(1);
    expect(text).toContain('{"sessionID":"ses-test","mode":"message","message":N,"part":P}');
    expect(text).toContain("- [1] read completed /workspace/a.ts → 12040 chars (26 input chars)\n");
    expect(text).not.toContain('"message":14,"part":1');
  });

  test("cached histories are dropped after the idle period and on dispose", async () => {
    const { SessionHistory } = await import("../plugins/session-reader/src/history.ts");
    spyOn(OpenCodeClient.prototype, "getSession").mockImplementation(async id => ({ data: { ...session, id } }));
    const pages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockResolvedValue({ data: [{ type: "user", text: "hi" }], cursor: {} });
    const history = new SessionHistory(new OpenCodeClient({}), {}, 5_000, 30);
    const signal = new AbortController().signal;
    await history.load("A", signal);
    await history.load("A", signal);
    expect(pages).toHaveBeenCalledTimes(1);
    expect(history.cached).toBe(1);
    await Bun.sleep(150);
    expect(history.cached).toBe(0);
    await history.load("A", signal);
    expect(pages).toHaveBeenCalledTimes(2);
    history.dispose();
    expect(history.cached).toBe(0);
  });
});
