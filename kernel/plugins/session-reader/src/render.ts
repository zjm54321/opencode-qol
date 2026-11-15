// SPDX-License-Identifier: GPL-3.0-or-later

import type { NumberedMessage, RenderOptions } from "./dehydrate.js";
import { errorText, excerpt, isTool, json, messageHeader, messageParts, messageText, messageType, partCall, readCall, renderMessage, toolName, toolOutput, truncate } from "./dehydrate.js";

export interface ListingOptions extends RenderOptions {
  maxChars: number;
  callMaxChars?: number;
  total: number;
  type?: string;
}

export function filterMessages(messages: NumberedMessage[], type?: string, tool?: string): NumberedMessage[] {
  return messages.filter(entry => (!type || messageType(entry.message) === type) && (!tool || messageParts(entry.message).some(part => isTool(part, tool))));
}

/** A listing never cuts through a message; its continuation preserves filters and numbering. */
export function renderListing(messages: NumberedMessage[], options: ListingOptions): { content: string; count: number; stoppedAt?: number } {
  if (!messages.length) return { content: `Messages: 0 of ${options.total}.\nNo conversation messages match these filters.`, count: 0 };
  const first = messages[0]!.number;
  const last = messages.at(-1)!.number;
  let content = `Messages #${first}–#${last} of ${options.total}`;
  if (options.detail !== "full" && !options.tool) content += `\nAny part in full: session_read({"sessionID":${json(options.sessionID)},"mode":"message","message":N,"part":P}) — N is the #number, P the [index] in front of a tool call.`;
  let count = 0;
  const continuation = (index: number) => `Stopped at #${messages[index]!.number} of #${first}–#${last} (output budget). Continue: ${readCall({
    sessionID: options.sessionID, mode: "slice", from: messages[index]!.number, limit: messages.length - index,
    detail: options.detail ?? "brief", ...(options.type ? { type: options.type } : {}), ...(options.tool ? { tool: options.tool } : {}), maxChars: options.callMaxChars ?? options.maxChars,
  })}`;
  for (const [index, entry] of messages.entries()) {
    const block = renderMessage(entry, options);
    const footer = index + 1 < messages.length ? `\n\n${continuation(index + 1)}` : "";
    if (content.length + block.length + 2 + footer.length > options.maxChars) {
      const oversized = count === 0 ? `\n\n#${entry.number} renders to ${block.length} chars. Read individual parts: ${partCall(options.sessionID, entry.number, undefined, undefined, options.maxChars)}` : "";
      return { content: truncate(`${content}${oversized}\n\n${continuation(index)}`, options.maxChars), count, stoppedAt: entry.number };
    }
    content += `\n\n${block}`;
    count++;
  }
  return { content, count };
}

export interface MessagePageOptions { sessionID: string; maxChars: number; callMaxChars?: number; part?: number; offset?: number }

/** Drill-down pages the raw output/text, not the bounded brief/full excerpts. */
export function renderMessagePage(entry: NumberedMessage, options: MessagePageOptions): string {
  const callBudget = options.callMaxChars ?? options.maxChars;
  const parts = messageParts(entry.message);
  if (options.part !== undefined && !parts[options.part - 1]) return `Message #${entry.number} has ${parts.length} parts; part ${options.part} does not exist.`;
  const selected = options.part === undefined ? parts.map((part, index) => ({ part, index })) : [{ part: parts[options.part - 1]!, index: options.part - 1 }];
  let content = `${messageHeader(entry)}\nMessage ID: ${entry.message.id ?? entry.message.info?.id ?? "unknown"} · ${parts.length} parts`;
  if (entry.message.error) content += `\n[${messageType(entry.message) === "assistant" ? "Assistant" : messageType(entry.message)} error] ${excerpt(errorText(entry.message.error), 6_000, partCall(options.sessionID, entry.number, undefined, undefined, 60_000))}`;
  if (!selected.length) return truncate(`${content}\n\n${renderMessage(entry, { sessionID: options.sessionID, detail: "full" }).split("\n\n").slice(1).join("\n\n")}`, options.maxChars);

  for (const [position, { part, index }] of selected.entries()) {
    const offset = options.part === undefined ? 0 : options.offset ?? 0;
    let prefix = `\n\n### [${index + 1}] ${part.type}`;
    let payload: string;
    if (part.type === "tool") {
      const output = toolOutput(part);
      prefix = `\n\n### [${index + 1}] ${toolName(part)} ${part.state?.status ?? "unknown"}`;
      if (part.state?.error) prefix += `\n[Tool error] ${errorText(part.state.error)}`;
      if (offset === 0) {
        const input = json(part.state?.input, true);
        prefix += `\nInput (${input.length} chars):\n${input}`;
        if (part.state?.metadata && Object.keys(part.state.metadata).length) prefix += `\nMetadata:\n${json(part.state.metadata, true)}`;
      }
      prefix += `\nOutput (${output.length} chars total; offset ${offset}):\n`;
      payload = output;
    } else { prefix += "\n"; payload = part.text ?? json(part, true); }
    const rest = payload.slice(offset);
    const next = selected[position + 1];
    const moreParts = next ? `\n\nRemaining parts start at [${next.index + 1}]. Continue: ${partCall(options.sessionID, entry.number, next.index + 1, undefined, callBudget)}` : "";
    if (content.length + prefix.length + rest.length + moreParts.length <= options.maxChars) {
      content += `${prefix}${rest}`;
      continue;
    }
    const later = next ? `\nThen read part [${next.index + 1}]: ${partCall(options.sessionID, entry.number, next.index + 1, undefined, callBudget)}` : "";
    const reserve = `\n\n(${payload.length} chars total; ${payload.length} remaining). Continue: ${partCall(options.sessionID, entry.number, index + 1, payload.length, callBudget)}${later}`;
    const room = options.maxChars - content.length - reserve.length - 2;
    if (prefix.length >= room && position > 0) {
      return truncate(`${content}\n\nRemaining parts start at [${index + 1}]. Continue: ${partCall(options.sessionID, entry.number, index + 1, undefined, callBudget)}`, options.maxChars);
    }
    if (prefix.length >= room) {
      // Large inputs can use a larger budget; offset remains an output/text offset.
      const call = partCall(options.sessionID, entry.number, index + 1, undefined, 60_000);
      const hint = `\n… [input/metadata truncated: ${prefix.length} chars total]. Read: ${call}\nOutput (${payload.length} chars total; offset ${offset}):\n`;
      prefix = prefix.slice(0, Math.max(0, room - hint.length - 200)) + hint;
    }
    const take = Math.max(0, options.maxChars - content.length - prefix.length - reserve.length - 2);
    const remaining = Math.max(0, rest.length - take);
    const footer = remaining === 0 && next ? `\n\n(${payload.length} chars total; 0 remaining).${moreParts}` : `\n\n(${payload.length} chars total; ${remaining} remaining). Continue: ${partCall(options.sessionID, entry.number, index + 1, offset + take, callBudget)}${later}`;
    return truncate(`${content}${prefix}${rest.slice(0, take)}${footer}`, options.maxChars);
  }
  return truncate(content, options.maxChars);
}

interface SearchField { part?: number; name: string; text: string }
function searchFields(entry: NumberedMessage, tool?: string): SearchField[] {
  const message = entry.message;
  const fields: SearchField[] = [];
  if (!tool && !["assistant", "user"].includes(messageType(message))) {
    if (messageType(message) === "compaction" && message.summary) fields.push({ name: "summary", text: message.summary });
    else if (messageText(message)) fields.push({ name: "text", text: messageText(message) });
  } else if (!tool && messageType(message) === "user") fields.push({ name: "text", text: messageText(message) });
  for (const [index, part] of messageParts(message).entries()) {
    if (part.type === "tool" && (!tool || isTool(part, tool))) {
      fields.push({ part: index + 1, name: `${toolName(part)}.input`, text: json(part.state?.input) });
      fields.push({ part: index + 1, name: `${toolName(part)}.output`, text: toolOutput(part) });
    } else if (!tool && messageType(message) === "assistant" && ["text", "reasoning"].includes(part.type)) fields.push({ part: index + 1, name: part.type, text: part.text ?? "" });
  }
  return fields;
}

export function renderSearch(messages: NumberedMessage[], options: RenderOptions & { query: string; limit: number; maxChars: number }): { content: string; hits: number; count: number } {
  const needle = options.query.toLowerCase();
  const hits: { entry: NumberedMessage; field: SearchField; snippet: string }[] = [];
  let total = 0;
  const matched = new Set<number>();
  for (const entry of [...messages].reverse()) for (const field of searchFields(entry, options.tool)) {
    const lower = field.text.toLowerCase();
    let offset = lower.indexOf(needle);
    while (offset !== -1) {
      total++;
      matched.add(entry.number);
      if (hits.length < options.limit) hits.push({ entry, field, snippet: field.text.slice(Math.max(0, offset - 100), offset + needle.length + 100).replace(/\s+/g, " ") });
      offset = lower.indexOf(needle, offset + Math.max(1, needle.length));
    }
  }
  let content = `${total} hits in ${matched.size} matching messages for ${json(options.query)}. Showing up to ${options.limit}, newest first.`;
  for (const { entry, field, snippet } of hits) {
    const block = `\n\n#${entry.number} ${messageType(entry.message)}${field.part ? ` [${field.part}]` : ""} ${field.name}\n${snippet}`;
    const footer = `\n\nSearch output budget reached. Read this hit: ${partCall(options.sessionID, entry.number, field.part, undefined, options.maxChars)}`;
    if (content.length + block.length + footer.length > options.maxChars) return { content: truncate(`${content}${footer}`, options.maxChars), hits: total, count: matched.size };
    content += block;
  }
  if (total > hits.length) content += `\n\n${total - hits.length} more hits. Increase limit (up to 200) or read a numbered message/part.`;
  return { content: truncate(content, options.maxChars), hits: total, count: matched.size };
}
