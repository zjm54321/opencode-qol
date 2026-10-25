import type { Mcp } from "@opencode/schema/mcp";
import type { Plugin } from "@opencode/plugin/promise/plugin";

export type BundledServers = Readonly<Record<string, Mcp.ServerConfig>>;

export function createBundledMcpPlugin(servers: BundledServers): Plugin {
  return {
    id: "qol-bundled-mcp",
    async setup(ctx) {
      const registration = await ctx.mcp.transform(editor => {
        for (const [name, config] of Object.entries(servers)) {
          // Presence, including disabled:true, is an explicit host/user choice.
          if (editor.get(name) !== undefined) continue;
          editor.set(name, structuredClone(config));
        }
      });
      return () => registration.dispose();
    },
  };
}
