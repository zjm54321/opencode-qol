import { expect, test } from "bun:test";
import path from "node:path";

const prepare = await Bun.file(new URL("../nix/prepare-source.mjs", import.meta.url)).text();

test("OMO TUI build bundles jsonc-parser while leaving host SDK imports external", () => {
  const build = prepare.match(/run\(required\("QOL_BUN"\), \["build", "src\/v2\/tui\.ts"[\s\S]*?\], omo\)/)?.[0];
  expect(build).toBeDefined();
  let args: string[] = [];
  new Function("run", "required", "omo", build!)((_command: string, input: string[]) => { args = input; }, () => "bun", "omo");
  const external = args.filter((_value, index) => args[index - 1] === "--external");
  expect(external).not.toContain("jsonc-parser");
  expect(external).toContain("@opencode/*");
});

test("source preparation selects jsonc-parser's ESM entry after copying dependencies", async () => {
  const patch = prepare.match(/const jsoncPackage = [\s\S]*?await fs\.writeFile\(jsoncPackage[^\n]+/)?.[0];
  expect(patch).toBeDefined();
  expect(prepare.indexOf(patch!)).toBeGreaterThan(prepare.indexOf('await copy(path.join(modules, "node_modules"), path.join(assets, "node_modules"))'));
  const manifest = { name: "jsonc-parser", main: "./lib/umd/main.js", module: "./lib/esm/main.js" };
  let result;
  const fs = {
    readFile: async (file: string) => {
      expect(file).toBe("/assets/node_modules/jsonc-parser/package.json");
      return JSON.stringify(manifest);
    },
    writeFile: async (file: string, text: string) => {
      expect(file).toBe("/assets/node_modules/jsonc-parser/package.json");
      result = JSON.parse(text);
    },
  };
  await new Function("fs", "path", "assets", `return (async () => { ${patch} })()`)(fs, path, "/assets");
  expect(result).toEqual({ ...manifest, main: "./lib/esm/main.js" });
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
