// Focused checks for the TUI renderer helper shipped inside patches/tui-qol-tools.patch.
// The helper exists only in the patched upstream tree, so it is extracted from the patch.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const PATCH = path.join(import.meta.dir, "../patches/tui-qol-tools.patch")
const TARGET = "+++ b/packages/tui/src/util/qol-tool-display.ts"

type Summary = { icon: string; title: string; lines: string[]; failed: boolean; running: boolean }
type Helper = {
  QOL_TOOL_DISPLAYS: readonly string[]
  clipText: (value: string, width: number) => string
  qolToolSubject: (tool: string) => string
  qolToolSummary: (input: {
    tool: string
    status: string
    input: object
    metadata: object
    output?: string
  }) => Summary | undefined
}
let helper: Helper
let directory: string

async function extract() {
  const lines = (await readFile(PATCH, "utf8")).split("\n")
  const start = lines.indexOf(TARGET)
  if (start === -1) throw new Error("qol-tool-display.ts is missing from the patch")
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("diff --git ")) break
    if (line.startsWith("@@")) continue
    if (line.startsWith("+")) body.push(line.slice(1))
  }
  return body.join("\n")
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "qol-tool-display-"))
  const file = path.join(directory, "qol-tool-display.ts")
  await writeFile(file, await extract())
  helper = await import(file)
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe("display selection", () => {
  test("covers exactly the three QoL session tools", () => {
    expect([...helper.QOL_TOOL_DISPLAYS].sort()).toEqual(
      ["session_diff", "session_list", "session_read"].sort(),
    )
    expect(helper.qolToolSummary({ tool: "webfetch", status: "completed", input: {}, metadata: {} })).toBeUndefined()
  })

  test("the patch registers them with the session view and opencode run", async () => {
    const patch = await readFile(PATCH, "utf8")
    expect(patch).toContain("+  ...QOL_TOOL_DISPLAYS,")
    expect(patch).toContain("+        <QolTool {...toolprops} />")
    for (const name of helper.QOL_TOOL_DISPLAYS) expect(patch).toContain(`+  ${name}: QOL_RULE,`)
  })

  test.each(["running", "completed", "error"])("native image generation keeps upstream generic rendering when %s", (status) => {
    const tool = "experimental_image_generate"
    expect(helper.QOL_TOOL_DISPLAYS).not.toContain(tool)
    expect(helper.qolToolSummary({ tool, status, input: {}, metadata: {} })).toBeUndefined()
    expect(helper.qolToolSubject(tool)).toBe(tool)
  })

  test("the session view only opts session tools into QoL rendering", async () => {
    const patch = await readFile(PATCH, "utf8")
    expect(patch).toContain("+      <Match when={QOL_SESSION_TOOLS.includes(display())}>")
    expect(patch).not.toContain('+  experimental_image_generate: QOL_RULE,')
  })
})

describe("session summaries", () => {
  const session = (tool: string, status: string, input: object, metadata: object = {}, output = "") =>
    helper.qolToolSummary({ tool, status, input, metadata, output })

  test("session_list", () => {
    expect(session("session_list", "running", {})).toMatchObject({ icon: "✱", title: "Listing sessions…" })
    expect(session("session_list", "completed", {}, { count: 1 })?.title).toBe("Listed 1 session")
    expect(session("session_list", "completed", {}, { count: 3, search: "pty", cursor: { next: "c" } })?.title).toBe(
      'Found 3 sessions matching "pty" · more available',
    )
    expect(session("session_list", "completed", { search: "pty" })?.title).toBe('Searched sessions "pty"')
    expect(session("session_list", "error", {})?.title).toBe("Couldn't list sessions")
  })

  test("session_read modes, counts and legacy header", () => {
    const meta = { sessionID: "ses_1", title: "Fix PTY", mode: "summary", count: 12 }
    expect(session("session_read", "completed", { sessionID: "ses_1" }, meta)).toMatchObject({
      icon: "→",
      title: 'Read session · "Fix PTY" · 12 messages',
    })
    expect(session("session_read", "completed", { sessionID: "ses_1", mode: "recent" }, { ...meta, mode: "recent", count: 1 })?.title).toBe(
      'Read recent messages · "Fix PTY" · 1 message',
    )
    expect(session("session_read", "running", { sessionID: "ses_1", mode: "slice" })?.title).toBe("Reading session history…")
    expect(session("session_read", "completed", { sessionID: "ses_1" }, {}, "# Old title\n\nSession: ses_1")?.title).toBe(
      'Read session · "Old title"',
    )
    expect(session("session_read", "completed", { sessionID: "ses_1" })?.title).toBe("Read session · ses_1")
  })

  test("diffs from session_diff and session_read mode=diff", () => {
    const meta = { sessionID: "s", title: "T", files: 2, additions: 5, deletions: 1 }
    expect(session("session_diff", "completed", { sessionID: "s" }, meta)?.title).toBe(
      'Read session diff · "T" · 2 files (+5/-1)',
    )
    expect(session("session_read", "completed", { sessionID: "s", mode: "diff" }, { ...meta, mode: "diff", files: 0 })?.title).toBe(
      'Read session diff · "T" · no changes',
    )
    expect(session("session_diff", "running", { sessionID: "s" })?.title).toBe("Reading session diff…")
  })
})

describe("width", () => {
  test("long and CJK titles are clipped by terminal cells", () => {
    const title = session_title("会".repeat(60))
    expect(title.endsWith('…"')).toBe(true)
    expect(helper.clipText("会".repeat(30), 10)).toBe("会会会会会…")
    expect(helper.clipText("a  b\n c", 10)).toBe("a b c")
  })
})

function session_title(title: string) {
  return helper.qolToolSummary({
    tool: "session_read",
    status: "completed",
    input: { sessionID: "s" },
    metadata: { title },
  })!.title
}
