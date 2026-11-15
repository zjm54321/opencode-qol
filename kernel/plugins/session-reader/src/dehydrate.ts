// SPDX-License-Identifier: GPL-3.0-or-later

import type { MessagePart, SessionMessage } from "./client.js";

export interface Turn { user?: string; messages: SessionMessage[] }
export interface NumberedMessage { number: number; message: SessionMessage }
export interface RenderOptions { sessionID: string; detail?: "brief" | "full"; tool?: string; finalAssistant?: number }

export function truncate(text: string, limit: number): string {
  const marker = "\n… [truncated]";
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - marker.length))}${marker.slice(0, limit)}`;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function json(value: unknown, pretty = false): string {
  return value === undefined ? "" : JSON.stringify(value, null, pretty ? 2 : undefined) ?? "";
}

export function messageType(message: SessionMessage): string {
  return message.type ?? message.role ?? message.info?.role ?? "unknown";
}

export function messageParts(message: SessionMessage): MessagePart[] {
  if (Array.isArray(message.content)) return message.content;
  if (message.parts) return message.parts;
  const text = message.text ?? (typeof message.content === "string" ? message.content : message.summary);
  return text === undefined ? [] : [{ type: "text", text }];
}

export function messageText(message: SessionMessage): string {
  return message.text ?? (typeof message.content === "string" ? message.content : messageParts(message).filter(part => part.type === "text").map(part => part.text ?? "").join("\n\n"));
}

export function toolName(part: MessagePart): string { return part.name ?? part.tool ?? "unknown"; }
export function baseToolName(part: MessagePart): string { return toolName(part).split(/[./]/).at(-1)!; }
export function isTool(part: MessagePart, name: string): boolean { return part.type === "tool" && (toolName(part) === name || baseToolName(part) === name); }
const INLINE_BINARY = /data:([\w.+-]+\/[\w.+-]+);base64,[A-Za-z0-9+/=]{256,}/g;
/** Inline images are megabytes of base64 that no reader can use: keep the media type and the size, drop the bytes. */
export function elideBinary(text: string): string {
  return text.includes(";base64,") ? text.replace(INLINE_BINARY, (match, mime: string) => `data:${mime};base64,[${match.length - mime.length - 13} base64 chars omitted]`) : text;
}
export function toolOutput(part: MessagePart): string {
  const content = part.state?.content;
  if (typeof content === "string") return elideBinary(content);
  if (Array.isArray(content)) return elideBinary(content.map(block => block.text ?? json(block)).join("\n"));
  return elideBinary(typeof part.state?.output === "string" ? part.state.output : json(part.state?.output));
}

export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  const value = record(error);
  return typeof value.message === "string" ? `${value.type ? `${value.type}: ` : ""}${value.message}` : error === undefined ? "" : json(error);
}

export function dateMillis(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isNaN(parsed) ? undefined : parsed; }
  const object = record(value);
  if (typeof object.epochMillis === "number") return object.epochMillis;
  return undefined;
}

export function localTime(value: unknown, year = false): string {
  const ms = dateMillis(value);
  if (ms === undefined || !Number.isFinite(ms)) return "unknown time";
  const date = new Date(ms);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${year ? `${date.getFullYear()}-` : ""}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoTime(value: unknown): string | null {
  const ms = dateMillis(value);
  return ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

export function modelID(model: unknown): string { return typeof model === "string" ? model : String(record(model).id ?? ""); }
export function createdTime(message: SessionMessage): unknown { return record(message.time).created ?? message.time; }
export function messageHeader(entry: NumberedMessage): string {
  const model = messageType(entry.message) === "assistant" ? modelID(entry.message.model) : "";
  return `## #${entry.number} ${messageType(entry.message)} · ${localTime(createdTime(entry.message))}${model ? ` · ${model}` : ""}`;
}

export function readCall(input: Record<string, unknown>): string { return `session_read(${json(input)})`; }
export function partCall(sessionID: string, number: number, part?: number, offset?: number, maxChars?: number): string {
  return readCall({ sessionID, mode: "message", message: number, ...(part === undefined ? {} : { part }), ...(offset === undefined ? {} : { offset }), ...(maxChars === undefined ? {} : { maxChars }) });
}

/** All excerpts retain the exact payload text and an actionable, numbered drill-down. */
export function excerpt(text: string, limit: number, call: string, tail = 0): string {
  if (text.length <= limit) return text;
  const end = Math.min(tail, limit);
  const start = limit - end;
  return `${text.slice(0, start)}\n… [${text.length - limit} chars omitted] …${end ? `\n${text.slice(-end)}` : ""}\n(${text.length} chars total). Read: ${call}`;
}

export function compressHeaders(content: unknown): string[] {
  if (typeof content === "string" && content.trimStart().startsWith("[")) {
    try { const parsed = JSON.parse(content); if (Array.isArray(parsed)) content = parsed; } catch { /* Plain text can start with a bracket. */ }
  }
  if (Array.isArray(content)) return content.flatMap(value => { const block = record(value); return block.startId && block.endId ? [`${block.startId}–${block.endId}`] : []; });
  if (typeof content !== "string") return [];
  return content.match(/^m\d+[–—-]m\d+(?:[ \t].*)?$/gm) ?? [];
}

export function childSessionID(part: MessagePart): string | undefined {
  const metadata = part.state?.metadata;
  const direct = metadata?.sessionID ?? metadata?.sessionId;
  if (typeof direct === "string") return direct;
  return `${json(metadata)}\n${toolOutput(part)}\n${json(part.state?.input)}`.match(/\bses_[A-Za-z0-9_-]+\b/)?.[0];
}

export function toolPreview(part: MessagePart): string {
  const input = record(part.state?.input);
  const name = baseToolName(part);
  let preview: string;
  if (name === "shell") preview = String(input.command ?? "");
  else if (["read", "write", "edit"].includes(name)) preview = String(input.path ?? input.filePath ?? input.file ?? "");
  else if (["grep", "glob"].includes(name)) preview = [input.pattern, input.path].filter(value => value !== undefined).join(" · ");
  else if (name === "subagent") preview = [input.agent, input.description, childSessionID(part)].filter(Boolean).join(" · ");
  else if (name === "todowrite") {
    const counts = new Map<string, number>();
    for (const todo of Array.isArray(input.todos) ? input.todos : []) { const status = String(record(todo).status ?? "pending"); counts.set(status, (counts.get(status) ?? 0) + 1); }
    preview = [...counts].map(([status, count]) => `${count} ${status}`).join(", ");
  } else if (name === "compress") preview = compressHeaders(input.content).join("; ") || String(input.summary ?? input.content ?? "");
  else if (name === "question") preview = (Array.isArray(input.questions) ? input.questions : []).map(question => record(question).question).join("; ") || String(input.question ?? "");
  else if (name === "webfetch") preview = String(input.url ?? "");
  else if (name === "websearch") preview = String(input.query ?? "");
  else if (name === "skill") preview = String(input.id ?? "");
  else if (name.startsWith("session_")) preview = [input.sessionID, input.mode].filter(Boolean).join(" · ");
  else preview = json(part.state?.input);
  return preview.replace(/\s+/g, " ").slice(0, 200);
}

export function renderMessage(entry: NumberedMessage, options: RenderOptions): string {
  const { message, number } = entry;
  const type = messageType(message);
  const full = options.detail === "full";
  const blocks = [messageHeader(entry)];
  const parts = messageParts(message);
  for (const [index, part] of parts.entries()) {
    const call = partCall(options.sessionID, number, index + 1);
    if (options.tool && !isTool(part, options.tool)) continue;
    if (part.type === "tool") {
      const status = part.state?.status ?? "unknown";
      const rawError = part.state?.error ? errorText(part.state.error).replace(/\s+/g, " ") : "";
      const error = rawError ? full || options.tool ? ` [Tool error] ${options.tool ? rawError : excerpt(rawError, 6_000, call)}` : ` [Tool error] ${rawError.slice(0, 300)}${rawError.length > 300 ? ` (${rawError.length} error chars total)` : ""}` : "";
      // One legend per listing explains the drill-down; repeating the call on every line cost a quarter of the output.
      if (!full && !options.tool) blocks.push(`- [${index + 1}] ${toolName(part)} ${status} ${toolPreview(part)} → ${toolOutput(part).length} chars${error} (${json(part.state?.input).length} input chars)`);
      else {
        const input = json(part.state?.input, true);
        const output = toolOutput(part);
        blocks.push(`### [${index + 1}] ${toolName(part)} ${status}${error}\nInput (${input.length} chars):\n${options.tool ? input : excerpt(input, 6_000, call)}\nOutput (${output.length} chars):\n${options.tool ? output : excerpt(output, 6_000, call, 2_000)}`);
        if (part.state?.metadata && Object.keys(part.state.metadata).length) blocks.push(`Metadata:\n${options.tool ? json(part.state.metadata, true) : excerpt(json(part.state.metadata, true), 6_000, call)}`);
      }
    } else if (part.type === "reasoning") {
      if (full) blocks.push(`### [${index + 1}] reasoning\n${excerpt(part.text ?? "", 3_000, call)}`);
    } else if (part.type === "text") {
      const cap = full ? 6_000 : type === "user" ? 4_000 : type === "synthetic" ? 800 : type === "system" ? 200 : type === "compaction" ? 1_500 : number === options.finalAssistant ? 3_000 : 1_500;
      blocks.push(excerpt(part.text ?? "", cap, call));
    } else if (full) blocks.push(`### [${index + 1}] ${part.type}\n${excerpt(json(part, true), 6_000, call)}`);
  }
  if (!options.tool) {
    if (type === "compaction" && message.status) blocks.push(`Compaction: ${message.status}`);
    if (type === "idle") blocks.push(`Outcome: ${message.outcome ?? "unknown"}`);
    if (type === "agent-switched") blocks.push(`Agent: ${String(message.previous ?? "unknown")} → ${String(message.agent ?? "unknown")}`);
    if (type === "model-switched") blocks.push(`Model: ${modelID(message.previous)} → ${modelID(message.model)}`);
    if (type === "location-switched") blocks.push(`Location: ${json(message.previous)} → ${json(message.location)}`);
    if (type === "shell") blocks.push(`Shell: ${message.status ?? "unknown"}${message.exit === undefined ? "" : ` · exit ${message.exit}`}`);
    if (message.error) blocks.push(`[${type === "assistant" ? "Assistant" : type} error] ${excerpt(errorText(message.error), full ? 6_000 : 300, partCall(options.sessionID, number))}`);
  }
  return blocks.join("\n\n");
}

export function parseTurns(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (messageType(message) === "user") turns.push({ user: messageText(message), messages: [message] });
    else { if (!turns.length) turns.push({ messages: [] }); turns.at(-1)!.messages.push(message); }
  }
  return turns;
}

export function dehydrateMessage(message: SessionMessage): string { return renderMessage({ number: 1, message }, { sessionID: "unknown" }); }
export function dehydrate(messages: readonly SessionMessage[]): string { return messages.map((message, index) => renderMessage({ number: index + 1, message }, { sessionID: "unknown" })).join("\n\n"); }
