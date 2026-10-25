import { expect, test } from "bun:test";
import path from "node:path";

const prepare = await Bun.file(new URL("../nix/prepare-source.mjs", import.meta.url)).text();

test("OMO TUI build leaves jsonc-parser and host SDK imports external", () => {
  const build = prepare.match(/run\(required\("QOL_BUN"\), \["build", "src\/v2\/tui\.ts"[\s\S]*?\], omo\)/)?.[0];
  expect(build).toBeDefined();
  let args: string[] = [];
  new Function("run", "required", "omo", build!)((_command: string, input: string[]) => { args = input; }, () => "bun", "omo");
  const external = args.filter((_value, index) => args[index - 1] === "--external");
  expect(external).toContain("jsonc-parser");
  expect(external).toContain("@opencode/*");
});

test("source preparation exposes extensionless host RPC without losing other exports", async () => {
  const patch = prepare.match(/const pluginPackage = [\s\S]*?await fs\.writeFile\(pluginPackage[^\n]+/)?.[0];
  expect(patch).toBeDefined();
  const manifest = { name: "@opencode/plugin", exports: { ".": "./src/promise/index.ts", "./*": "./src/*.ts" } };
  let result;
  const fs = {
    readFile: async (file: string) => {
      expect(file).toBe("/source/packages/plugin/package.json");
      return JSON.stringify(manifest);
    },
    writeFile: async (_file: string, text: string) => { result = JSON.parse(text); },
  };
  await new Function("fs", "path", "source", `return (async () => { ${patch} })()`)(fs, path, "/source");
  expect(result).toEqual({ ...manifest, exports: { ...manifest.exports, "./rpc": "./src/rpc.ts" } });
});
