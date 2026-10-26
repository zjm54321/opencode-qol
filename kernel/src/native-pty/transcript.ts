// A request-local view of the daemon's bounded raw replay. Never stores output.
export function unescapeInput(input: string): string {
  return input.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[nrt\\])/g, (_, escape: string) => {
    if (escape[0] === "x" || escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(1), 16))
    return ({ n: "\n", r: "\r", t: "\t", "\\": "\\" } as Record<string, string>)[escape]!
  })
}

export function compilePattern(pattern?: string, ignoreCase = false): RegExp | undefined {
  if (pattern === undefined) return
  // Preserve the former tool's heuristic rejection and reject common nested
  // repetition/backreference risks before evaluating against a full 2MiB line.
  if (pattern.length > 1000 || /\\[1-9]|\(\?[=!<]|\([^)]*[*+{][^)]*\)[*+{]|\([^)]*\|[^)]*\)[*+{]/.test(pattern) ||
    /\(\?:.*\)\*.*\(\?:.*\)\*/.test(pattern))
    throw new Error("Potentially dangerous regex pattern; simplify the expression")
  try { return new RegExp(pattern, ignoreCase ? "i" : "") }
  catch (error) { throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : error}`) }
}

export function transcript(
  replay: { requestedOffset: number; availableOffset: number; endOffset: number; truncated: boolean; data: Uint8Array },
  input: { offset?: number; limit?: number; pattern?: string; ignoreCase?: boolean },
) {
  const regex = compilePattern(input.pattern, input.ignoreCase)
  const offset = input.offset ?? 0
  const limit = input.limit ?? 500
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new Error("offset must be a non-negative integer and limit a positive integer")
  // The bounded byte window may start in a UTF-8 code point. Skip only leading
  // continuation bytes; stream decoding also withholds an unfinished tail.
  let skip = 0
  while (skip < replay.data.length && (replay.data[skip]! & 0xc0) === 0x80) skip++
  const text = new TextDecoder().decode(replay.data.subarray(skip), { stream: true })
  const lines = text.length ? text.split(/\r?\n/) : []
  if (lines.at(-1) === "" && text.endsWith("\n")) lines.pop()
  const matched = lines.map((text, line) => ({ line: line + 1, text })).filter(({ text }) => !regex || regex.test(text))
  let clipped = false
  const page = matched.slice(offset, offset + limit).map(({ line, text }) => {
    const chars = Array.from(text)
    if (chars.length > 2000) clipped = true
    return { line, text: chars.slice(0, 2000).join("") }
  })
  const more = offset + page.length < matched.length
  const notes = [
    replay.truncated ? "Native replay window was cropped; line offsets are relative to this window and may shift. The first line may be incomplete." : "",
    skip ? `Skipped ${skip} partial UTF-8 byte(s) at the window boundary.` : "",
    clipped ? "Long lines were clipped to 2000 characters." : "",
    more ? `More results: use offset=${offset + page.length}.` : "",
  ].filter(Boolean)
  return {
    lines: page, totalLines: lines.length, totalMatches: matched.length, offset, limit, more,
    bytes: { requested: replay.requestedOffset, available: replay.availableOffset, decoded: replay.availableOffset + skip, end: replay.endOffset },
    truncated: replay.truncated, firstLineIncomplete: replay.availableOffset > 0, clipped, notes,
    text: [...(page.length ? page.map(({ line, text }) => `${line}: ${text}`) : [regex ? "No matching lines." : "No output."]), ...notes].join("\n"),
  }
}
