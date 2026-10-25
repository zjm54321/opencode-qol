import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Error as ToolError } from "@opencode/plugin/promise/tool";

// Only the host registration/context is isolated; ToolError is the actual V2 schema class.
mock.module("@opencode/plugin", () => ({ Plugin: { define: (definition: unknown) => definition } }));
const { default: imagePlugin } = await import("../plugins/image/src/index.ts");
const { default: sessionPlugin } = await import("../plugins/session-reader/src/index.ts");
const { executeOpenAIImageGen } = await import("../plugins/image/src/openai.ts");
const { executeNanoBananaImageGen } = await import("../plugins/image/src/nanobanana.ts");
const { readImage } = await import("../plugins/image/src/images.ts");
const { OpenCodeClient } = await import("../plugins/session-reader/src/client.ts");

let workspace: string;
let originalEnv: NodeJS.ProcessEnv;
const originalFetch = globalThis.fetch;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWLsAAAAASUVORK5CYII=";
const config = { apiKey: "test-secret-key", default_model: "gpt-image-2.5-flare", available_models: ["gpt-image-2.5-flare"] };
const nanoConfig = { ...config, default_model: "gemini-3.1-flash-image", available_models: ["gemini-3.1-flash-image"] };
const nanoImage = { inlineData: { mimeType: "image/png", data: png } };
const cursor = { previous: "prev-token", next: "next-token" };
const session = { id: "ses-test", title: "Test title", directory: "/workspace" };
const testRoot = path.join(tmpdir(), "opencode");

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true });
  workspace = await mkdtemp(path.join(testRoot, "qol-native-tools-"));
  originalEnv = { ...process.env };
  process.env.XDG_CONFIG_HOME = path.join(workspace, "config");
  process.env.OPENAI_API_KEY = config.apiKey;
  process.env.GEMINI_API_KEY = config.apiKey;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  mock.restore();
  process.env = originalEnv;
  await rm(workspace, { recursive: true, force: true });
});

async function register(plugin: any) {
  const tools = new Map<string, any>();
  const context = {
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
function respond(value: unknown, status = 200) { return async () => Response.json(value, { status }); }

describe("direct native image tools", () => {
  test("image tool registrations opt out of codemode and retain validated input", async () => {
    const { tools } = await register(imagePlugin);
    expect([...tools.keys()]).toEqual(["image_gen", "image_gen_nano", "image_models"]);
    for (const tool of tools.values()) expect(tool.options).toEqual({ codemode: false });
    expect(tools.get("image_gen").input.safeParse({ prompt: "" }).success).toBe(false);
    expect(tools.get("image_gen").input.safeParse({ prompt: "x", num_last_images_to_include: 6 }).success).toBe(false);
  });

  test.each(["all", "openai", "google"])("image_models lists whitelisted %s models in OpenCode format", async provider => {
    await writeFile(path.join(workspace, "opencode.json"), JSON.stringify({ image_generation: {
      openai: { whitelist: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] },
      google: { whitelist: ["gemini-3.1-flash-image"] },
    } }));
    const fetcher = mock(respond({}));
    globalThis.fetch = fetcher as typeof fetch;
    const { tools } = await register(imagePlugin);
    const tool = tools.get("image_models");
    const input = tool.input.parse(provider === "all" ? {} : { provider });
    expect(input.provider).toBe(provider);
    const result = await tool.execute(input, execution());
    const models = [
      { providerID: "openai", id: "gpt-image-2.5-flare" },
      { providerID: "openai", id: "gpt-image-2.5-sunburst" },
      { providerID: "google", id: "gemini-3.1-flash-image" },
    ].filter(model => provider === "all" || model.providerID === provider);
    expect(result.metadata).toEqual({ count: models.length, models });
    expect(result.content).toBe(models.map(model => `${model.providerID}/${model.id}`).sort((a, b) => a.localeCompare(b)).join("\n"));
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("image_models lists configured available models without a whitelist", async () => {
    await writeFile(path.join(workspace, "opencode.json"), JSON.stringify({ image_generation: {
      openai: { available_models: ["custom-openai-image"] },
      google: { available_models: ["custom-google-image"] },
    } }));
    const { tools } = await register(imagePlugin);
    const tool = tools.get("image_models");
    const result = await tool.execute(tool.input.parse({}), execution());
    expect(result.content).toBe("google/custom-google-image\nopenai/custom-openai-image");
    expect(result.metadata).toEqual({ count: 2, models: [
      { providerID: "openai", id: "custom-openai-image" },
      { providerID: "google", id: "custom-google-image" },
    ] });
  });

  test.each(["image_gen", "image_gen_nano"])("%s rejects missing and blank models with the available whitelist", async name => {
    const engineConfig = name === "image_gen" ? config : nanoConfig;
    const provider = name === "image_gen" ? "openai" : "google";
    const available = engineConfig.available_models;
    await writeFile(path.join(workspace, "opencode.json"), JSON.stringify({ image_generation: {
      [provider]: { whitelist: available },
    } }));
    const fetcher = mock(respond({}));
    globalThis.fetch = fetcher as typeof fetch;
    const { tools } = await register(imagePlugin);
    for (const input of [{ prompt: "x" }, { prompt: "x", model: "" }, { prompt: "x", model: "  " }]) {
      await expect(tools.get(name).execute(input, execution())).rejects.toMatchObject({
        _tag: "Tool.Error",
        message: JSON.stringify({
          status: "error",
          error_code: "MODEL_REQUIRED",
          message: `Image model must be explicitly specified. Available models: ${available.join(", ")}`,
          available_models: available,
        }),
        metadata: { error_code: "MODEL_REQUIRED", available_models: available },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(["openai", "nano"])("%s requires an explicit model even with a configured default and no whitelist", async provider => {
    const engineConfig = provider === "openai" ? config : nanoConfig;
    const run = provider === "openai" ? executeOpenAIImageGen : executeNanoBananaImageGen;
    const fetcher = mock(respond({}));
    globalThis.fetch = fetcher as typeof fetch;
    await expect(run({ prompt: "x" }, workspace, { config: engineConfig })).rejects.toMatchObject({
      _tag: "Tool.Error",
      metadata: { error_code: "MODEL_REQUIRED", available_models: engineConfig.available_models },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([1, 2])("OpenAI returns actual metadata and saved links for %i image(s)", async count => {
    globalThis.fetch = mock(respond({ data: Array.from({ length: count }, () => ({ b64_json: png })) })) as typeof fetch;
    const { tools } = await register(imagePlugin);
    const result = await tools.get("image_gen").execute({ prompt: "test", model: "gpt-image-2.5-flare", aspect_ratio: "16:9" }, execution());
    expect(result.metadata).toMatchObject({ count, model: "gpt-image-2.5-flare", aspect_ratio: "16:9", edited: false });
    expect(result.metadata.files).toHaveLength(count);
    for (const file of result.metadata.files) {
      expect(result.content).toContain(`](${file})`);
      expect(await readFile(path.join(workspace, file))).toEqual(Buffer.from(png, "base64"));
    }
  });

  test.each([1, 2])("Nano returns actual metadata for %i non-thought image(s)", async count => {
    globalThis.fetch = mock(respond({ candidates: [{ content: { parts: [{ ...nanoImage, thought: true }, ...Array.from({ length: count }, () => nanoImage)] } }] })) as typeof fetch;
    const { tools } = await register(imagePlugin);
    const result = await tools.get("image_gen_nano").execute({ prompt: "test", model: "gemini-3.1-flash-image" }, execution());
    expect(result.metadata).toMatchObject({ count, model: "gemini-3.1-flash-image", aspect_ratio: "1:1", edited: false });
    expect(result.metadata.files).toHaveLength(count);
  });

  test("edits use local references/current-context images and propagate signal", async () => {
    await writeFile(path.join(workspace, "ref.png"), Buffer.from(png, "base64"));
    const signal = new AbortController().signal;
    globalThis.fetch = mock(async (_url, options) => {
      expect(options?.signal).toBe(signal);
      expect(options?.body).toBeInstanceOf(FormData);
      return Response.json({ data: [{ b64_json: png }] });
    }) as typeof fetch;
    const { tools, context } = await register(imagePlugin);
    context.session.context = async () => [{ content: "![reference](ref.png)" }] as any;
    const result = await tools.get("image_gen").execute({ prompt: "edit", model: "gpt-image-2.5-flare", num_last_images_to_include: 1 }, execution(signal));
    expect(result.metadata.edited).toBe(true);
  });

  test("Nano continuity marks reuse as an edit without exposing other conversations", async () => {
    const bodies: any[] = [];
    globalThis.fetch = mock(async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({ candidates: [{ content: { parts: [nanoImage] } }] });
    }) as typeof fetch;
    const { tools } = await register(imagePlugin);
    const tool = tools.get("image_gen_nano");
    const input = { prompt: "test", model: "gemini-3.1-flash-image", session_id: "series" };
    expect((await tool.execute(input, execution())).metadata.edited).toBe(false);
    expect((await tool.execute(input, execution())).metadata.edited).toBe(true);
    expect((await tool.execute(input, { ...execution(), sessionID: "ses-other" })).metadata.edited).toBe(false);
    expect(bodies.map(body => body.contents.length)).toEqual([1, 3, 1]);
  });

  test.each(["openai", "nano"])("%s provider/empty responses throw real V2 Tool.Error with redacted secrets", async provider => {
    const run = provider === "openai"
      ? () => executeOpenAIImageGen({ prompt: "test", model: "gpt-image-2.5-flare" }, workspace, { config })
      : () => executeNanoBananaImageGen({ prompt: "test", model: "gemini-3.1-flash-image" }, workspace, { config: nanoConfig });
    globalThis.fetch = mock(respond({ error: config.apiKey }, 403)) as typeof fetch;
    try { await run(); throw new Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError)._tag).toBe("Tool.Error");
      expect((error as Error).message).toContain("HTTP_403");
      expect((error as Error).message).not.toContain(config.apiKey);
    }
    globalThis.fetch = mock(respond({})) as typeof fetch;
    await expect(run()).rejects.toMatchObject({ _tag: "Tool.Error", metadata: { error_code: "EMPTY_RESULT" } });
  });

  test("allowlist and invalid reference failures do not make provider calls", async () => {
    const fetcher = mock(respond({}));
    globalThis.fetch = fetcher as typeof fetch;
    await expect(executeOpenAIImageGen({ prompt: "x", model: "not-enabled" }, workspace, { config })).rejects.toMatchObject({ metadata: { error_code: "MODEL_NOT_CONFIGURED" } });
    await expect(executeOpenAIImageGen({ prompt: "x", model: "gpt-image-2.5-flare", num_last_images_to_include: 1 }, workspace, { config })).rejects.toMatchObject({ metadata: { error_code: "INVALID_ARGUMENT" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(["openai", "nano"])("%s strictly rejects models outside a non-empty whitelist before provider calls", async provider => {
    const engineConfig = provider === "openai" ? config : nanoConfig;
    const run = provider === "openai" ? executeOpenAIImageGen : executeNanoBananaImageGen;
    const fetcher = mock(respond({}));
    globalThis.fetch = fetcher as typeof fetch;
    for (const { model, whitelist } of [
      { model: engineConfig.default_model, whitelist: ["allowed-first", "allowed-second"] },
      { model: "not-configured", whitelist: [engineConfig.default_model] },
      { model: engineConfig.default_model, whitelist: ["*"] },
    ]) {
      const requestedModel = model;
      await expect(run({ prompt: "x", model }, workspace, { config: { ...engineConfig, whitelist } })).rejects.toMatchObject({
        _tag: "Tool.Error",
        message: JSON.stringify({
          status: "error",
          error_code: "MODEL_NOT_IN_WHITELIST",
          message: `Model '${requestedModel}' is not in the allowed whitelist. Allowed models: ${whitelist.join(", ")}`,
          requested_model: requestedModel,
          whitelist,
        }),
        metadata: { error_code: "MODEL_NOT_IN_WHITELIST", requested_model: requestedModel, whitelist },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(["openai", "nano"])("%s accepts allowed models and absent or empty whitelists", async provider => {
    const engineConfig = provider === "openai" ? config : nanoConfig;
    const run = provider === "openai" ? executeOpenAIImageGen : executeNanoBananaImageGen;
    const fetcher = mock(respond(provider === "openai"
      ? { data: [{ b64_json: png }] }
      : { candidates: [{ content: { parts: [nanoImage] } }] }));
    globalThis.fetch = fetcher as typeof fetch;
    for (const whitelist of [undefined, [], [engineConfig.default_model]]) {
      const result = await run({ prompt: "x", model: engineConfig.default_model }, workspace, { config: { ...engineConfig, whitelist } });
      expect(result.metadata.model).toBe(engineConfig.default_model);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test.each(["image_gen", "image_gen_nano"])("%s registered execution propagates actual failure", async name => {
    const { tools } = await register(imagePlugin);
    globalThis.fetch = mock(respond({})) as typeof fetch;
    const model = name === "image_gen" ? "gpt-image-2.5-flare" : "gemini-3.1-flash-image";
    await expect(tools.get(name).execute({ prompt: "test", model }, execution())).rejects.toMatchObject({ _tag: "Tool.Error", metadata: { error_code: "EMPTY_RESULT" } });
  });

  test("invalid configuration errors do not quote embedded credentials", async () => {
    const { tools } = await register(imagePlugin);
    await writeFile(path.join(workspace, "opencode.json"), `{"apiKey":"${config.apiKey}", invalid}`);
    try { await tools.get("image_gen").execute({ prompt: "test", model: "gpt-image-2.5-flare" }, execution()); throw new Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as Error).message).toContain("expected a valid JSON object");
      expect((error as Error).message).not.toContain(config.apiKey);
    }
  });

  test("reference and generated-image symlinks cannot escape the workspace", async () => {
    const outside = await mkdtemp(path.join(testRoot, "qol-native-outside-"));
    try {
      await writeFile(path.join(outside, "ref.png"), Buffer.from(png, "base64"));
      await symlink(outside, path.join(workspace, "outside"));
      await expect(readImage("outside/ref.png", workspace)).rejects.toThrow("inside the workspace");
      await symlink(outside, path.join(workspace, ".opencode"));
      globalThis.fetch = mock(respond({ data: [{ b64_json: png }] })) as typeof fetch;
      await expect(executeOpenAIImageGen({ prompt: "x", model: "gpt-image-2.5-flare" }, workspace, { config })).rejects.toThrow("inside the workspace");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  test.each(["openai", "nano"])("%s abort preserves cancellation instead of success/error JSON", async provider => {
    const controller = new AbortController();
    const reason = new Error("cancelled by test");
    globalThis.fetch = mock(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort(reason);
      throw reason;
    }) as typeof fetch;
    const run = provider === "openai"
      ? executeOpenAIImageGen({ prompt: "x", model: "gpt-image-2.5-flare" }, workspace, { config, signal: controller.signal })
      : executeNanoBananaImageGen({ prompt: "x", model: "gemini-3.1-flash-image" }, workspace, { config: nanoConfig, signal: controller.signal });
    await expect(run).rejects.toBe(reason);
  });
});

describe("direct session tools", () => {
  test("registrations, counts, summary and opaque cursors remain accurate", async () => {
    const list = spyOn(OpenCodeClient.prototype, "listSessions").mockResolvedValue({ data: [session], cursor });
    spyOn(OpenCodeClient.prototype, "getSession").mockResolvedValue({ data: session });
    spyOn(OpenCodeClient.prototype, "getSessionContext").mockResolvedValue({ data: [{ role: "user", text: "first" }, { role: "assistant", text: "second" }] });
    const messages = spyOn(OpenCodeClient.prototype, "getSessionMessages").mockResolvedValue({ data: [{ role: "user", text: "hello" }], cursor });
    const { tools } = await register(sessionPlugin);
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

  test("local service preserves cursor encoding, errors redact credentials, abort reaches HTTP", async () => {
    const configDirectory = path.join(workspace, "service-config");
    await mkdir(configDirectory);
    const requests: URL[] = [];
    let fail = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push(new URL(request.url));
      if (fail) return new Response(`failure ${config.apiKey} ${Buffer.from(`opencode:${config.apiKey}`).toString("base64")}`, { status: 401 });
      return Response.json({ data: [session], cursor });
    } });
    await writeFile(path.join(configDirectory, "service.json"), JSON.stringify({ port: server.port, password: config.apiKey }));
    try {
      const client = new OpenCodeClient({ configDirectory });
      const result = await client.listSessions({ cursor: "opaque+/=", search: "a & b" });
      expect(result.cursor).toEqual(cursor);
      expect(requests[0].searchParams.get("cursor")).toBe("opaque+/=");
      expect(requests[0].searchParams.get("search")).toBe("a & b");
      fail = true;
      try { await client.listSessions(); throw new Error("expected failure"); } catch (error) {
        expect((error as Error).message).toContain("HTTP 401");
        expect((error as Error).message).not.toContain(config.apiKey);
        expect((error as Error).message).not.toContain(Buffer.from(`opencode:${config.apiKey}`).toString("base64"));
      }
      const controller = new AbortController();
      const reason = new Error("cancel session request");
      const aborted = new OpenCodeClient({ configDirectory, fetch: (async (_url, options) => {
        expect(options?.signal?.aborted).toBe(false);
        controller.abort(reason);
        expect(options?.signal?.aborted).toBe(true);
        throw reason;
      }) as typeof fetch });
      await expect(aborted.listSessions({}, controller.signal)).rejects.toBe(reason);
    } finally { await server.stop(true); }
  });
});
