import { describe, expect, mock, test } from "bun:test";
import type { Mcp } from "@opencode/schema/mcp";
import type { Context } from "@opencode/plugin/promise/plugin";
import type { MCPEditor } from "@opencode/plugin/promise/mcp";
import { createBundledMcpPlugin, type BundledServers } from "../plugins/bundled-mcp/src/plugin.ts";

const servers: BundledServers = {
  codegraph: { type: "local", command: ["/nix/store/test-codegraph/bin/codegraph", "serve", "--mcp"], environment: { CODEGRAPH_NO_DAEMON: "1" } },
  nixos: { type: "local", command: ["/nix/store/test-nixos/bin/mcp-nixos"] },
};

async function harness(initial: Record<string, Mcp.ServerConfig> = {}) {
  const configs = new Map(Object.entries(initial));
  const set = mock((name: string, config: Mcp.ServerConfig) => { configs.set(name, config); });
  const editor = { get: (name: string) => configs.get(name), set } as MCPEditor;
  let transform!: (editor: MCPEditor) => void;
  const dispose = mock(async () => {});
  const ctx = {
    mcp: { transform: async (callback: typeof transform) => { transform = callback; callback(editor); return { dispose }; } },
  } as unknown as Context;
  const cleanup = await createBundledMcpPlugin(servers).setup(ctx);
  return { configs, set, dispose, cleanup, rerun: () => transform(editor) };
}

describe("bundled MCP defaults", () => {
  test("registers only the two packaged local servers, without starting/indexing anything", async () => {
    const h = await harness();
    expect(Object.fromEntries(h.configs)).toEqual(servers);
    expect(h.set).toHaveBeenCalledTimes(2);
    h.rerun();
    expect(h.set).toHaveBeenCalledTimes(2);
    expect(h.configs.get("codegraph")).not.toBe(servers.codegraph);
    await h.cleanup?.();
    expect(h.dispose).toHaveBeenCalledTimes(1);
  });

  test.each([true, false])("preserves user codegraph config including disabled:%s", async disabled => {
    const user: Mcp.ServerConfig = { type: "local", command: ["/custom/codegraph"], disabled, environment: { USER_CHOICE: "1" } };
    const h = await harness({ codegraph: user });
    expect(h.configs.get("codegraph")).toBe(user);
    expect(h.configs.get("nixos")).toEqual(servers.nixos);
    expect(h.set).toHaveBeenCalledTimes(1);
  });

  test("preserves remote overrides and unrelated Slim/host MCPs", async () => {
    const user: Mcp.ServerConfig = { type: "remote", url: "https://example.invalid/nixos", disabled: true };
    const context7: Mcp.ServerConfig = { type: "remote", url: "https://example.invalid/context7" };
    const gh: Mcp.ServerConfig = { type: "remote", url: "https://example.invalid/gh-grep" };
    const h = await harness({ nixos: user, context7, gh_grep: gh });
    expect(h.configs.get("nixos")).toBe(user);
    expect(h.configs.get("context7")).toBe(context7);
    expect(h.configs.get("gh_grep")).toBe(gh);
    expect(h.set).toHaveBeenCalledTimes(1);
    expect([...h.configs.keys()].sort()).toEqual(["codegraph", "context7", "gh_grep", "nixos"]);
  });
});
