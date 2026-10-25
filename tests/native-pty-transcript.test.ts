import { describe, expect, test } from "bun:test"
import { compilePattern, transcript, unescapeInput } from "../src/native-pty/transcript"

const replay = (text: string) => ({ requestedOffset: 0, availableOffset: 0, endOffset: Buffer.byteLength(text), truncated: false, data: Buffer.from(text) })
describe("native PTY compatibility", () => {
  test("literal escapes and control input are decoded exactly once", () => {
    expect(unescapeInput(String.raw`a\n\r\t\x03\u001b\\n`)).toBe("a\n\r\t\x03\x1b\\n")
    expect(unescapeInput("\x03\x1b[A")).toBe("\x03\x1b[A")
    expect(unescapeInput(String.raw`\xZZ\q`)).toBe(String.raw`\xZZ\q`)
  })
  test("ordinary pages preserve original one-based line numbers", () => {
    const result = transcript(replay("first\r\nsecond\r\nthird\n"), { offset: 1, limit: 1 })
    expect(result.lines).toEqual([{ line: 2, text: "second" }])
    expect(result.more).toBe(true)
    expect(result.text).toContain("offset=2")
    expect(result.totalLines).toBe(3)
  })
  test("regex filters before match pagination, with original numbering", () => {
    const result = transcript(replay("err1\nokay\nERR2\nerr3\n"), { pattern: "err", ignoreCase: true, offset: 1, limit: 1 })
    expect(result.lines).toEqual([{ line: 3, text: "ERR2" }])
    expect(result.totalMatches).toBe(3)
    expect(transcript(replay("ERR\n"), { pattern: "err" }).text).toBe("No matching lines.")
  })
  test("invalid and heuristic-dangerous patterns fail before reading", () => {
    expect(() => compilePattern("[")).toThrow("Invalid regex")
    for (const pattern of ["(a+)+$", "(a|aa)*$", "(?:a)*(?:b)*", "(?=a)", "(a)\\1", "x".repeat(1001)])
      expect(() => compilePattern(pattern)).toThrow("dangerous regex")
  })
  test("empty, out-of-range, live partial lines and long-line clipping are explicit", () => {
    expect(transcript(replay(""), {}).text).toBe("No output.")
    expect(transcript(replay("x"), { offset: 4 }).lines).toEqual([])
    expect(transcript(replay("partial"), {}).lines[0]?.text).toBe("partial")
    const result = transcript(replay("😀".repeat(2001)), {})
    expect(Array.from(result.lines[0]!.text)).toHaveLength(2000)
    expect(result.clipped).toBe(true)
    const defaultPage = transcript(replay("line\n".repeat(501)), {})
    expect(defaultPage.lines).toHaveLength(500)
    expect(defaultPage.offset).toBe(0)
    expect(defaultPage.more).toBe(true)
  })
  test("cropped 2MiB window and incomplete UTF8 boundaries do not invent replacement characters", () => {
    const raw = Buffer.from("界".repeat(800000) + "\nend😀")
    const data = raw.subarray(raw.length - 2 * 1024 * 1024, raw.length - 2)
    const result = transcript({ requestedOffset: 0, availableOffset: raw.length - 2 * 1024 * 1024, endOffset: raw.length - 2, truncated: true, data }, {})
    expect(result.lines.every((line) => !line.text.includes("�"))).toBe(true)
    expect(result.lines.at(-1)?.text).toBe("end")
    expect(result.firstLineIncomplete).toBe(true)
    expect(result.notes.join(" ")).toContain("cropped")
  })
})
