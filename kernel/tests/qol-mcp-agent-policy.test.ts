import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import defaults from "../defaults/oh-my-opencode-slim.json";
import { createBundledMcpPlugin, type BundledServers } from "../plugins/bundled-mcp/src/plugin.ts";
import type { Context } from "@opencode/plugin/promise/plugin";
import { mergePluginConfigs } from "../vendor/oh-my-opencode-slim/src/config/loader.ts";
import { compilePermissionPolicy } from "../vendor/oh-my-opencode-slim/src/v2/permissions.ts";
import { createV2Setup } from "../vendor/oh-my-opencode-slim/src/v2/setup.ts";
import type { V2Context, V2PermissionRule } from "../vendor/oh-my-opencode-slim/src/v2/types.ts";
import { flushLoggerForTesting } from "../vendor/oh-my-opencode-slim/src/utils/logger.ts";

// Real Slim factory/setup/registry/adapters run against a narrow host-domain
// harness, following its upstream setup.e2e.test.ts. This is NOT a full host
// catalog/MCP connection test: descriptors never execute a server here.
const bundled: BundledServers = {
  codegraph: { type: "local", command: ["/nix/store/policy-codegraph/bin/codegraph", "serve", "--mcp"], environment: { CODEGRAPH_NO_DAEMON: "1" } },
  nixos: { type: "local", command: ["/nix/store/policy-nixos/bin/mcp-nixos"] },
};
const actions = {
  codegraph: "codegraph_codegraph_explore",
  nixos: "nixos_nix",
  context7: "context7_query-docs",
  gh_grep: "gh_grep_searchGitHub",
};
type McpConfig = BundledServers[string];
type McpDraft = {
  list(): [string, McpConfig][];
  get(name: string): McpConfig | undefined;
  set(name: string, config: McpConfig): void;
};
type Agent = { id: string; permissions?: V2PermissionRule[]; [key: string]: unknown };

let originalEnv: NodeJS.ProcessEnv;
let fixture: string;
let cleanups: (() => void | Promise<void>)[];

beforeEach(async () => {
  originalEnv = { ...process.env };
  cleanups = [];
  fixture = await mkdtemp("/tmp/opencode/qol-mcp-policy-");
  Object.assign(process.env, {
    OPENCODE_CONFIG_DIR: path.join(fixture, "config"),
    OPENCODE_LOG_DIR: path.join(fixture, "logs"),
    XDG_CONFIG_HOME: path.join(fixture, "xdg-config"),
    XDG_DATA_HOME: path.join(fixture, "xdg-data"),
    XDG_CACHE_HOME: path.join(fixture, "xdg-cache"),
  });
  delete process.env.OH_MY_OPENCODE_SLIM_DISABLE;
});

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await flushLoggerForTesting();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(fixture, { recursive: true, force: true });
});

async function setup(options: {
  override?: Parameters<typeof mergePluginConfigs>[1];
  hostMcps?: Record<string, McpConfig>;
  bundledFirst?: boolean;
} = {}) {
  const directory = path.join(fixture, "project");
  await mkdir(path.join(directory, ".opencode"), { recursive: true });
  await writeFile(path.join(directory, ".opencode/oh-my-opencode-slim.json"),
    JSON.stringify(mergePluginConfigs(defaults, options.override ?? {})));
  const transforms: ((draft: McpDraft) => void)[] = [];
  const snapshots: string[][] = [];
  let mcps = new Map<string, McpConfig>();
  const replayMcps = () => {
    mcps = new Map(Object.entries(structuredClone(options.hostMcps ?? {})));
    const draft: McpDraft = {
      list: () => { snapshots.push([...mcps.keys()]); return [...mcps]; },
      get: name => mcps.get(name),
      set: (name, config) => { mcps.set(name, config); },
    };
    for (const transform of transforms) transform(draft);
  };
  const agents = new Map<string, Agent>();
  const registration = () => ({ dispose: async () => {} });
  const nativeSubagent = { description: "Native subagent", execute: async () => ({}) };
  const stored = new Map<string, unknown>();
  const ctx = {
    app: { name: "opencode", version: "2.2.5" }, options: {},
    location: { directory, project: { id: "policy-project", directory, canonical: directory } },
    storage: {
      get: async (key: string) => structuredClone(stored.get(key)),
      set: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
      remove: async (key: string) => { stored.delete(key); },
      scan: async () => ({ entries: [] }),
    },
    mcp: {
      transform: async (callback: (draft: McpDraft) => void) => {
        transforms.push(callback);
        replayMcps();
        return registration();
      },
      reload: async () => replayMcps(),
    },
    agent: {
      transform: async (callback: (draft: unknown) => void) => {
        callback({
          list: () => [], get: (name: string) => agents.get(name), default() {},
          update: (name: string, update: (agent: Agent) => void) => {
            const agent = agents.get(name) ?? { id: name };
            update(agent);
            agents.set(name, agent);
          },
          remove: (name: string) => { agents.delete(name); },
        });
        return registration();
      },
      reload: async () => {}, list: async () => [],
    },
    tool: {
      transform: async (callback: (draft: unknown) => void) => {
        callback({ get: (name: string) => name === "subagent" ? nativeSubagent : undefined,
          update: (name: string, update: (tool: typeof nativeSubagent) => void) => { if (name === "subagent") update(nativeSubagent); }, add() {} });
        return registration();
      }, hook: async () => registration(),
    },
    command: { transform: async (callback: (draft: unknown) => void) => { callback({ add() {} }); return registration(); }, list: async () => [] },
    skill: { transform: async () => registration(), list: async () => [], reload: async () => {} },
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, directory, agent: "orchestrator" }), hook: async () => registration() },
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
    generate: { text: async () => ({ text: "unused" }) },
  };
  const bundledSetup = () => createBundledMcpPlugin(bundled).setup(ctx as unknown as Context);
  const slimSetup = () => createV2Setup()(ctx as unknown as V2Context);
  const ordered = options.bundledFirst === false ? [slimSetup, bundledSetup] : [bundledSetup, slimSetup];
  for (const start of ordered) {
    const cleanup = await start();
    if (cleanup) cleanups.push(cleanup);
  }
  return {
    agents, snapshots, mcps,
    policy(agent: string) {
      const rules = agents.get(agent)?.permissions;
      expect(rules).toBeArray();
      return compilePermissionPolicy({ baselineRules: rules!, hostRules: [] });
    },
  };
}

describe("bundled MCP → real Slim V2 agent policy (host-domain harness, not catalog E2E)", () => {
  test("locks the actual builtin setup order and admits all four MCPs to explorer", async () => {
    const source = await readFile(new URL("../src/builtin.ts", import.meta.url), "utf8");
    const order = source.match(/QolPlugins[^=]*=\s*\[([\s\S]*?)\]/)?.[1];
    expect(order).toBeDefined();
    expect(order!.indexOf("bundledMcp")).toBeLessThan(order!.indexOf("omo"));
    const h = await setup();
    expect(h.snapshots[0]).toEqual(["codegraph", "nixos"]);
    expect([...h.mcps.keys()].sort()).toEqual(["codegraph", "context7", "gh_grep", "nixos"]);
    for (const action of Object.values(actions)) expect(h.policy("explorer").decide(action, "*")).toBe("allow");
    for (const agent of ["oracle", "designer", "fixer"]) expect(h.agents.has(agent)).toBe(true);
    for (const agent of ["oracle", "designer", "fixer"]) {
      expect(h.policy(agent).decide(actions.codegraph, "*")).toBe("allow");
      expect(h.policy(agent).decide(actions.nixos, "*")).toBe(agent === "fixer" ? "allow" : "deny");
      for (const action of [actions.context7, actions.gh_grep]) expect(h.policy(agent).decide(action, "*")).toBe("deny");
    }
    expect(h.policy("orchestrator").decide(actions.context7, "*")).toBe("deny");
    expect(h.policy("orchestrator").decide(actions.gh_grep, "*")).toBe("deny");
    for (const action of [actions.codegraph, actions.nixos]) expect(h.policy("orchestrator").decide(action, "*")).toBe("allow");
  });

  test("an explicit user explorer mcps list replaces the baked allowlist", async () => {
    const h = await setup({ override: { agents: { explorer: { mcps: ["nixos"] } } } });
    expect(h.policy("explorer").decide(actions.nixos, "*")).toBe("allow");
    for (const action of [actions.codegraph, actions.context7, actions.gh_grep]) expect(h.policy("explorer").decide(action, "*")).toBe("deny");
  });

  test("same-name user servers, including disabled choices, survive both real transforms", async () => {
    const hostMcps: Record<string, McpConfig> = {
      codegraph: { type: "local", command: ["/user/codegraph"], disabled: true },
      nixos: { type: "remote", url: "https://user.invalid/nixos", disabled: true },
      context7: { type: "remote", url: "https://user.invalid/context7", disabled: true },
    };
    const h = await setup({ hostMcps });
    for (const [name, config] of Object.entries(hostMcps)) expect(h.mcps.get(name)).toEqual(config);
    // Disabled connection/catalog behavior belongs to the real host, not this
    // harness; the contract proven here is preserving the authoritative flag.
  });

  test("reproduces the former late-inventory hole with the same real setup functions", async () => {
    const h = await setup({ bundledFirst: false });
    expect(h.snapshots.every(snapshot => !snapshot.includes("codegraph"))).toBe(true);
    expect(h.mcps.has("codegraph")).toBe(true);
    expect(h.policy("oracle").decide(actions.codegraph, "*")).toBe("allow");
  });
});
