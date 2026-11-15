// SPDX-License-Identifier: GPL-3.0-or-later

import type { MessagePart } from "./client.js";
import type { NumberedMessage } from "./dehydrate.js";
import { baseToolName, childSessionID, compressHeaders, isTool, messageParts, record } from "./dehydrate.js";

export interface ToolCall { number: number; part: number; call: MessagePart }
export function toolCalls(messages: NumberedMessage[], name?: string): ToolCall[] {
  return messages.flatMap(entry => messageParts(entry.message).flatMap((call, index) => call.type === "tool" && (!name || isTool(call, name)) ? [{ number: entry.number, part: index + 1, call }] : []));
}

export interface WrittenFile { path: string; count: number; last: number; part: number }
export function writtenFiles(messages: NumberedMessage[]): WrittenFile[] {
  const files = new Map<string, WrittenFile>();
  for (const { number, part, call } of toolCalls(messages)) {
    const name = baseToolName(call);
    if (!["write", "edit", "apply_patch"].includes(name)) continue;
    const input = record(call.state?.input);
    const paths = new Set<string>();
    const direct = input.path ?? input.filePath ?? input.file;
    if (typeof direct === "string") paths.add(direct);
    if (name === "apply_patch") {
      const patch = typeof call.state?.input === "string" ? call.state.input : input.patchText ?? input.patch ?? input.input;
      if (typeof patch === "string") for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) paths.add(match[1]!.trim());
    }
    for (const path of paths) files.set(path, { path, count: (files.get(path)?.count ?? 0) + 1, last: number, part });
  }
  return [...files.values()].sort((a, b) => b.last - a.last || a.path.localeCompare(b.path));
}

export interface SummaryBlock { header: string; text: string }
export function compressBlocks(call: MessagePart): SummaryBlock[] {
  const input = record(call.state?.input);
  let content = input.content ?? input.summary;
  if (typeof content === "string" && content.trimStart().startsWith("[")) {
    try { const parsed = JSON.parse(content); if (Array.isArray(parsed)) content = parsed; } catch { /* Plain summaries can start with a bracket. */ }
  }
  if (Array.isArray(content)) return content.map(value => {
    const block = record(value);
    return { header: block.startId && block.endId ? `${block.startId}–${block.endId}` : "Summary", text: String(block.summary ?? "") };
  }).filter(block => block.text);
  if (typeof content !== "string" || !content) return [];
  const headers = compressHeaders(content);
  if (!headers.length) return [{ header: "Summary", text: content }];
  const matches = [...content.matchAll(/^m\d+[–—-]m\d+(?:[ \t].*)?$/gm)];
  return matches.map((match, index) => ({ header: match[0], text: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).replace(/^\r?\n/, "").trimEnd() }));
}

export function numberRanges(values: number[]): string {
  const ordered = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const start = ordered[index]!;
    let end = start;
    while (ordered[index + 1] === end + 1) end = ordered[++index]!;
    ranges.push(start === end ? `#${start}` : `#${start}–#${end}`);
  }
  return ranges.join(", ");
}

export function subagentDispatches(messages: NumberedMessage[]): (ToolCall & { childID?: string; agent: string; description: string })[] {
  return toolCalls(messages, "subagent").map(dispatch => ({ ...dispatch, childID: childSessionID(dispatch.call), agent: String(record(dispatch.call.state?.input).agent ?? "unknown"), description: String(record(dispatch.call.state?.input).description ?? "") }));
}
