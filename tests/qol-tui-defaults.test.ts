import { describe, expect, test } from "bun:test"

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
  test.each(["oh-my-opencode-slim:tui", "opencode-qol"])("TUI plugin %s is visible", (id) => {
    expect(internal[0]({ id })).toBe(false)
  })

  test.each([
    "oh-my-opencode-slim", "billion-context-opencode-native", "opencode-qol.native-pty",
    "opencode-imagegen", "session-reader", "clear-encrypted", "gpt-taste",
    "provider-model-policy", "opencode.desktop-bridge", "qol-bundled-mcp",
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
