import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Only the host registration/context is isolated.
mock.module("@opencode/plugin", () => ({ Plugin: { define: (definition: unknown) => definition } }));
const { default: sessionPlugin } = await import("../plugins/session-reader/src/index.ts");
const { OpenCodeClient, readServiceRegistration } = await import("../plugins/session-reader/src/client.ts");

let workspace: string;
let originalEnv: NodeJS.ProcessEnv;
const originalFetch = globalThis.fetch;
const password = "test-service-password";
const cursor = { previous: "prev-token", next: "next-token" };
const session = { id: "ses-test", title: "Test title", directory: "/workspace" };
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
    expect(listed.metadata).toEqual({ count: 1, cursor });
    expect(list).toHaveBeenCalledWith({ search: undefined, directory: workspace, limit: 1, order: undefined, cursor: "native-cursor" });
    const read = tools.get("session_read");
    const recent = await read.execute({ sessionID: session.id, mode: "recent", limit: 2 }, execution());
    expect(recent.content).toContain("last question");
    expect(recent.content.indexOf("last question")).toBeLessThan(recent.content.indexOf("last answer"));
    expect(recent.content).not.toContain("first question");
    expect(recent.metadata).toMatchObject({ count: 2, cursor: {}, source: "active-context" });
    const slice = await read.execute({ sessionID: session.id, mode: "slice", limit: 1 }, execution());
    expect(slice.content).toContain("first question");
    expect(slice.content).not.toContain("last question");
    const descending = await read.execute({ sessionID: session.id, mode: "slice", limit: 2, order: "desc", type: "user", cursor: "http-cursor" }, execution());
    expect(descending.content).toContain("full-history pagination is unavailable");
    expect(descending.content.indexOf("first question")).toBeLessThan(descending.content.indexOf("last question"));
    expect(descending.content).not.toContain("answer");
    const summary = await read.execute({ sessionID: session.id, mode: "summary", limit: 1 }, execution());
    expect(summary.content).toContain("last answer");
    expect(get).toHaveBeenCalledWith({ sessionID: session.id });
    expect(active).toHaveBeenCalledWith({ sessionID: session.id });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test.each([[], { data: [], cursor: {} }, undefined])("empty native session list returns immediately without HTTP: %j", async value => {
    const http = spyOn(OpenCodeClient.prototype, "listSessions").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    const list = mock(async () => value);
    Object.assign(context.session, { list });
    const result = await tools.get("session_list").execute({}, execution());
    expect(result.content).toBe("[]\n\nPagination: {}");
    expect(result.metadata).toEqual({ count: 0, cursor: {} });
    expect(list).toHaveBeenCalledTimes(1);
    expect(http).not.toHaveBeenCalled();
  }, 1_000);

  test.each(["summary", "recent", "slice"])("missing native session returns immediately in %s mode", async mode => {
    const http = spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    const active = mock(async () => []);
    for (const value of [undefined, null, { data: undefined }, { data: null }]) {
      Object.assign(context.session, { get: async () => value, context: active });
      const result = await tools.get("session_read").execute({ sessionID: "ses-missing", mode }, execution());
      expect(result).toEqual({
        content: "Session not found: ses-missing",
        metadata: { sessionID: "ses-missing", mode, count: 0, available: false },
      });
    }
    expect(active).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  }, 1_000);

  test.each(["summary", "recent", "slice"])("empty native session returns a header immediately in %s mode", async mode => {
    const get = spyOn(OpenCodeClient.prototype, "getSession").mockRejectedValue(new Error("HTTP must not run"));
    const active = spyOn(OpenCodeClient.prototype, "getSessionContext").mockRejectedValue(new Error("HTTP must not run"));
    const page = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockRejectedValue(new Error("HTTP must not run"));
    const { tools, context } = await register(sessionPlugin);
    for (const value of [[], { data: [] }, undefined]) {
      Object.assign(context.session, { get: async () => session, context: async () => value });
      const result = await tools.get("session_read").execute({ sessionID: session.id, mode }, execution());
      expect(result.content).toBe(`# ${session.title}\n\nSession: ${session.id}\nDirectory: ${session.directory}\n\nNo conversation messages in this session.`);
      expect(result.metadata).toMatchObject({ sessionID: session.id, title: session.title, mode, count: 0 });
    }
    expect(get).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
  }, 1_000);

  test.each(["summary", "recent", "slice"])("missing HTTP session returns a result in %s mode after native failure", async mode => {
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

  test("failed native list falls back to HTTP and reports unavailable if both fail", async () => {
    const http = spyOn(OpenCodeClient.prototype, "listSessions").mockResolvedValue({ data: [], cursor: {} });
    const { tools, context } = await register(sessionPlugin);
    Object.assign(context.session, { list: async () => { throw new Error("native unavailable"); } });
    const tool = tools.get("session_list");
    expect((await tool.execute({}, execution())).metadata).toEqual({ count: 0, cursor: {} });
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
    expect(result.content).toBe(`# ${session.title}\n\nSession: ${session.id}\nDirectory: ${session.directory}\n\nNo conversation messages in this session.`);
    expect(result.metadata).toMatchObject({ count: 0, mode });
  });

  test("the real SDK SessionDomain has context but no native diff method", async () => {
    const source = await readFile(Bun.resolveSync("@opencode/plugin/promise/session", import.meta.dir), "utf8");
    const domain = source.slice(source.indexOf("export type SessionDomain ="));
    expect(domain).toContain('| "context"');
    expect(domain).not.toContain('"diff"');
  });

  test("diff HTTP failure returns a standalone hint without a native diff method", async () => {
    spyOn(OpenCodeClient.prototype, "getSessionDiff").mockRejectedValue(new Error("offline"));
    const { tools, context } = await register(sessionPlugin);
    expect(context.session).not.toHaveProperty("diff");
    for (const [name, input] of [["session_diff", { sessionID: session.id }], ["session_read", { sessionID: session.id, mode: "diff" }]] as const) {
      const result = await tools.get(name).execute(input, execution());
      expect(result.content).toBe("No file diffs available for this session in standalone mode.");
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

  test("registrations, counts, summary and opaque cursors remain accurate", async () => {
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
    expect(result.metadata).toEqual({ count: 1, search: "test", cursor });
    expect(result.content).toContain(JSON.stringify(cursor));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ cursor: "opaque+/=", order: undefined, directory: undefined }), ctx.signal);
    const summary = await tools.get("session_read").execute({ sessionID: session.id, mode: "summary", limit: 1 }, ctx);
    expect(summary.metadata).toEqual({ sessionID: session.id, title: session.title, mode: "summary", count: 1 });
    const page = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", cursor: "opaque+/=" }, ctx);
    expect(page.metadata).toEqual({ sessionID: session.id, title: session.title, mode: "slice", count: 1, cursor });
    expect(page.content).toContain(JSON.stringify(cursor));
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({ cursor: "opaque+/=", order: undefined }), ctx.signal);
  });

  test("diff and read(diff) count actual selected files; unknown line counts stay unknown", async () => {
    spyOn(OpenCodeClient.prototype, "getSessionDiff").mockResolvedValue({ data: [
      { file: "a.ts", before: "old", after: "new", additions: 2, deletions: 1 },
      { file: "b.ts", before: "", after: "new" },
    ] });
    const { tools } = await register(sessionPlugin);
    const diff = await tools.get("session_diff").execute({ sessionID: session.id, file: "a.ts" }, execution());
    expect(diff.metadata).toEqual({ sessionID: session.id, files: 1, additions: 2, deletions: 1 });
    const read = await tools.get("session_read").execute({ sessionID: session.id, mode: "diff" }, execution());
    expect(read.metadata).toEqual({ sessionID: session.id, mode: "diff", count: 2, files: 2 });
    expect(read.content).toContain("b.ts");
    const empty = await tools.get("session_diff").execute({ sessionID: session.id, file: "missing" }, execution());
    expect(empty.metadata).toEqual({ sessionID: session.id, files: 0, additions: 0, deletions: 0 });
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
    const pageCursor = Buffer.from(JSON.stringify({ order: "desc", token: "opaque+/=" })).toString("base64");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      if (request.headers.get("authorization") !== `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`) return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/api/session") return Response.json({ data: [session], cursor });
      if (url.pathname.endsWith("/diff")) return Response.json({ data: diffs });
      if (url.pathname.endsWith("/message")) return Response.json({ data: [{ role: "assistant", text: "historic answer" }, { role: "user", text: "historic question" }], cursor });
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
      expect(diff.metadata).toEqual({ sessionID: session.id, files: 1, additions: 1, deletions: 1 });
      const readDiff = await tools.get("session_read").execute({ sessionID: session.id, mode: "diff" }, execution());
      expect(readDiff.metadata).toMatchObject({ count: 1, files: 1, mode: "diff" });
      const page = await tools.get("session_read").execute({ sessionID: session.id, mode: "slice", cursor: pageCursor, limit: 2, type: "user" }, execution());
      expect(page.content.indexOf("historic question")).toBeLessThan(page.content.indexOf("historic answer"));
      expect(page.content).not.toContain("active context only");
      expect(page.content).toContain(JSON.stringify(cursor));
      expect(page.metadata).toEqual({ sessionID: session.id, title: session.title, mode: "slice", count: 2, cursor });
      const request = requests.find(url => url.pathname.endsWith("/message"))!;
      expect(request.searchParams.get("cursor")).toBe(pageCursor);
      expect(request.searchParams.get("order")).toBeNull();
      expect(request.searchParams.get("limit")).toBe("2");
      expect(request.searchParams.get("type")).toBe("user");
      const summary = await tools.get("session_read").execute({ sessionID: session.id, mode: "summary" }, execution());
      expect(summary.content).toContain("active question");
      expect(summary.metadata.count).toBe(1);
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

  test("HTTP fallback times out after the default 2500ms instead of hanging", async () => {
    const stateDirectory = path.join(workspace, "service-state");
    await writeRegistration(stateDirectory);
    const client = new OpenCodeClient({ stateDirectory, fetch: ((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    })) as typeof fetch });
    await expect(client.getSession("ses-missing")).rejects.toThrow("timed out after 2500ms");
  }, 4_000);
});
