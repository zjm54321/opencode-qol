import { describe, expect, test } from "bun:test"
import path from "node:path"

const patch = await Bun.file(new URL("../patches/tui-qol-tools.patch", import.meta.url)).text()
const section = patch.split("diff --git a/packages/tui/src/mini/tool.ts")[0]
const additions = section.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n")
const declaration = additions.match(/const qolPlugins = new Set\(\[[\s\S]*?\]\)/)?.[0]
if (!declaration) throw new Error("Missing bundled plugin visibility policy")

// Execute the actual expressions shipped in the patch, without importing the TUI renderer.
const expressions = [...additions.matchAll(/internal: (.+),/g)].map((match) => match[1])
if (expressions.length !== 2) throw new Error("Missing TUI or server visibility expression")
const internal = expressions.map((expression) => new Function("plugin", `${declaration}; return ${expression}`))

test("session sidebar is shown by default, including narrow terminals", async () => {
  const config = await Bun.file(new URL("../defaults/opencode.json", import.meta.url)).json()
  expect(config.session.sidebar).toBe("show")
})

describe("bundled plugin visibility without external configuration", () => {
  test.each(["oh-my-opencode-slim:tui", "opencode-qol", "opencode.qol.clear-encrypted-contents", "opencode.qol.future-plugin"])("TUI plugin %s is visible", (id) => {
    expect(internal[0]({ id })).toBe(false)
  })

  test.each([
    "oh-my-opencode-slim", "billion-context-opencode-native", "opencode.qol.native-pty",
    "opencode.qol.session-reader", "opencode.qol.clear-encrypted-contents", "opencode.qol.gpt-taste",
    "opencode.qol.model-policy", "opencode.qol.desktop-bridge", "opencode.qol.bundled-mcp", "opencode.qol.future-plugin",
  ])("server plugin %s is visible", (id) => {
    expect(internal[1]({ id, source: { type: "builtin" } })).toBe(false)
  })

  test("core internals retain the internal toggle and external plugins remain visible", () => {
    expect(internal[0]({ id: "opencode.core" })).toBe(true)
    expect(internal[1]({ id: "opencode.core", source: { type: "builtin" } })).toBe(true)
    expect(internal[1]({ source: { type: "builtin" } })).toBe(true)
    expect(internal[1]({ id: "third-party", source: { type: "package" } })).toBe(false)
    expect(internal[1]({ id: "third-party", source: { type: "local" } })).toBe(false)
  })
})

describe("native image generation build registration", () => {
  test("the builtin registry imports and registers only retained QoL execution plugins", async () => {
    const builtin = await Bun.file(new URL("../src/builtin.ts", import.meta.url)).text()
    const plugins = builtin.match(/export const QolPlugins: readonly EffectPlugin\[\] = \[([\s\S]*?)\]\.map\(adapt\)/)?.[1]
    expect(plugins).toBeDefined()
    expect(plugins!.split(",").map((name) => name.trim()).filter(Boolean)).toEqual([
      "bundledMcp", "omo", "billion", "sessionReader", "clearEncrypted", "gptTaste", "modelPolicy", "desktopBridge", "nativeUi",
    ])
    expect([...builtin.matchAll(/from "\.\/plugins\/([^"]+)"/g)].map((match) => match[1])).toEqual([
      "session-reader/src/index.ts", "clear-encrypted/src/index.ts", "gpt-taste/index.js",
      "model-policy/index.js", "desktop-bridge/src/index.ts", "bundled-mcp/src/index.ts",
      "native-ui/src/index.ts",
    ])
  })

  test("source preparation stages only retained local execution plugins", async () => {
    const prepare = await Bun.file(new URL("../nix/prepare-source.mjs", import.meta.url)).text()
    const names = prepare.match(/for \(const name of (\[[^\]]+\])\) \{\n  await copy\(path\.join\(repository, "plugins", name\)/)?.[1]
    expect(names).toBeDefined()
    expect(JSON.parse(names!)).toEqual(["session-reader", "clear-encrypted", "desktop-bridge", "bundled-mcp", "native-ui"])
  })

  test("local skills come from packaged defaults and are mirrored to OMO", async () => {
    const prepare = await Bun.file(new URL("../nix/prepare-source.mjs", import.meta.url)).text()
    const localSkills = prepare.match(/\/\/ Local repository skills\n([\s\S]*?)\n\n  \/\/ Bundle/)?.[1]
    expect(localSkills).toBeDefined()
    const copies: string[][] = []
    await new Function("copy", "path", "repository", "assets", `return (async () => { ${localSkills} })()`)(
      async (from: string, to: string) => { copies.push([from, to]) }, path, "/repository", "/assets",
    )
    expect(copies).toEqual([
      ["/repository/defaults/skills/start-work", "/assets/vendor/oh-my-opencode-slim/src/skills/start-work"],
      ["/repository/defaults/skills/image-generation", "/assets/vendor/oh-my-opencode-slim/src/skills/image-generation"],
      ["/repository/defaults/skills/native-ui", "/assets/vendor/oh-my-opencode-slim/src/skills/native-ui"],
    ])
    expect(prepare.split('await copy(path.join(repository, "defaults"), path.join(assets, "defaults"))')).toHaveLength(2)
    expect(prepare).toContain('defaultCfg.skills = [path.join(output, "defaults/skills")]')
  })

  test("the native UI skill joins the OMO installer registry for primary orchestration", async () => {
    const patch = await Bun.file(new URL("../patches/omo-qol-enhancements.patch", import.meta.url)).text()
    const entry = patch.match(/\+  \{\n\+    name: 'native-ui',[\s\S]*?\n\+  \},/)?.[0]
    expect(entry).toBeDefined()
    expect(entry).toContain("allowedAgents: ['orchestrator']")
    expect(entry).toContain("sourcePath: 'src/skills/native-ui'")
    expect(await Bun.file(new URL("../defaults/skills/native-ui/SKILL.md", import.meta.url)).exists()).toBe(true)
  })

  test("QoL global defaults leave image provider and model selection to user configuration", async () => {
    const config = await Bun.file(new URL("../defaults/opencode.json", import.meta.url)).json()
    expect(Object.keys(config).filter((key) => /image|provider|model/.test(key))).toEqual([])
  })
})
