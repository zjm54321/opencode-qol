// SPDX-License-Identifier: GPL-3.0-or-later

import type { SessionInfo } from "./client.js";
import type { NumberedMessage } from "./dehydrate.js";
import type { LoadedSession } from "./history.js";
import { ACTIVE_CONTEXT_NOTICE } from "./history.js";
import { createdTime, errorText, excerpt, json, localTime, messageParts, messageText, messageType, modelID, partCall, readCall, record, truncate } from "./dehydrate.js";
import { compressBlocks, numberRanges, subagentDispatches, toolCalls, writtenFiles } from "./evidence.js";
import { renderListing } from "./render.js";

function bounded(text: string, cap: number, call: string): string {
  if (text.length <= cap) return text;
  const marker = `\n… [${text.length} chars total; section truncated]. Read: ${call}`;
  return `${text.slice(0, Math.max(0, cap - marker.length))}${marker}`.slice(0, cap);
}

export function filesSection(messages: NumberedMessage[], sessionID: string, cap = 2_000, file?: string): string {
  const files = writtenFiles(messages).filter(row => file === undefined || row.path === file);
  if (!files.length) return "";
  const rows = files.slice(0, 40).map(row => `- ${row.path} — ${row.count} call${row.count === 1 ? "" : "s"}, last #${row.last}`);
  const title = "## Files written or edited";
  let visible = rows.length;
  const footer = () => visible < files.length ? `\n+${files.length - visible} more. Read: ${readCall({ sessionID, mode: "slice", from: 1, detail: "full", tool: "write" })} (also tool:"edit" / "apply_patch").` : "";
  while (visible > 1 && `${title}\n${rows.slice(0, visible).join("\n")}${footer()}`.length > cap) visible--;
  return bounded(`${title}\n${rows.slice(0, visible).join("\n")}${footer()}`, cap, partCall(sessionID, files[0]!.last, files[0]!.part, undefined, 60_000));
}

function header(loaded: LoadedSession, messages: NumberedMessage[]): string {
  const session = loaded.session;
  const counts = new Map<string, number>();
  for (const entry of messages) { const type = messageType(entry.message); counts.set(type, (counts.get(type) ?? 0) + 1); }
  const lastAssistant = messages.findLast(entry => messageType(entry.message) === "assistant");
  const idle = messages.findLast(entry => messageType(entry.message) === "idle");
  const unfinished = lastAssistant ? messageParts(lastAssistant.message).flatMap((part, index) => part.type === "tool" && !["completed", "error", "failed", "cancelled"].includes(part.state?.status ?? "unknown") ? [`[${index + 1}] ${part.name ?? part.tool ?? "unknown"} ${part.state?.status ?? "unknown"}`] : []) : [];
  const compaction = messages.findLast(entry => messageType(entry.message) === "compaction" && entry.message.status === "completed");
  return [
    `# ${session.title}`, `Session: ${session.id}`, `Directory: ${session.location?.directory ?? session.directory ?? "unknown"}`, `Parent: ${session.parentID ?? "none"}`,
    `Created: ${localTime(session.time?.created, true)} · Updated: ${localTime(session.time?.updated, true)}`,
    `${messages.length} messages (${[...counts].map(([type, count]) => `${type}: ${count}`).join(", ") || "none"})`,
    ...(messages.length ? [`Message time range: ${localTime(createdTime(messages[0]!.message), true)} – ${localTime(createdTime(messages.at(-1)!.message), true)}`] : []),
    `Agent: ${session.agent ?? "unknown"} · Model: ${modelID(session.model) || "unknown"} · Cost: ${typeof session.cost === "number" ? `$${session.cost.toFixed(2)}` : "unknown"}`,
    ...(session.tokens ? [`Tokens: ${json(session.tokens)}`] : []),
    `How it ended: ${lastAssistant ? `assistant #${lastAssistant.number} finish=${lastAssistant.message.finish ?? "unfinished"}${lastAssistant.message.error ? `; error=${errorText(lastAssistant.message.error).slice(0, 500)}` : ""}` : "no assistant response"}${idle ? `; idle #${idle.number} outcome=${idle.message.outcome ?? "unknown"}${idle.message.error ? `; ${errorText(idle.message.error).slice(0, 300)}` : ""}` : ""}`,
    ...(unfinished.length ? [`Unfinished tool calls in last assistant #${lastAssistant!.number}: ${unfinished.join(", ")}`] : []),
    ...(compaction ? [`Active context starts at #${compaction.number}`] : []),
    ...(loaded.source === "active-context" ? [ACTIVE_CONTEXT_NOTICE] : []),
    ...(loaded.capped ? ["History safety cap reached: showing the first 50,000 stored messages."] : []),
  ].join("\n");
}

function promptsSection(messages: NumberedMessage[], sessionID: string, cap: number): string {
  const users = messages.filter(entry => messageType(entry.message) === "user");
  if (!users.length) return "";
  const title = "## User prompts";
  const call = readCall({ sessionID, mode: "slice", from: 1, type: "user", detail: "full", maxChars: 60_000 });
  const block = (entry: NumberedMessage, size = 3_000) => `### #${entry.number}\n${excerpt(messageText(entry.message), size, partCall(sessionID, entry.number))}`;
  const all = `${title}\n${users.map(entry => block(entry)).join("\n\n")}`;
  if (all.length <= cap) return all;
  const selected = new Set([users[0]!.number, users.at(-1)!.number]);
  const omission = () => `\n\nOmitted user prompts: ${numberRanges(users.filter(entry => !selected.has(entry.number)).map(entry => entry.number)) || "none"}. Read all: ${call}`;
  let available = Math.max(0, cap - title.length - omission().length - 100);
  let firstSize = Math.min(3_000, Math.floor(available / (users.length > 1 ? 2 : 1)));
  let lastSize = Math.min(3_000, Math.max(0, available - Math.min(messageText(users[0]!.message).length, firstSize)));
  const renderSelected = () => `${title}\n${users.filter(entry => selected.has(entry.number)).map(entry => block(entry, entry.number === users[0]!.number ? firstSize : entry.number === users.at(-1)!.number ? lastSize : 3_000)).join("\n\n")}${omission()}`;
  for (const entry of users.slice(1, -1).reverse()) { selected.add(entry.number); if (renderSelected().length > cap) selected.delete(entry.number); }
  while (renderSelected().length > cap && (firstSize > 0 || lastSize > 0)) { firstSize = Math.max(0, firstSize - 100); lastSize = Math.max(0, lastSize - 100); }
  return bounded(renderSelected(), cap, call);
}

function todoSection(messages: NumberedMessage[], sessionID: string, cap: number): string {
  const latest = toolCalls(messages, "todowrite").findLast(row => row.call.state?.status === "completed" && Array.isArray(record(row.call.state.input).todos));
  if (!latest) return "";
  const todos = record(latest.call.state!.input).todos as unknown[];
  if (!todos.length) return "";
  const symbols: Record<string, string> = { completed: "x", in_progress: "~", pending: " ", cancelled: "-" };
  return bounded(`## Latest todo list (#${latest.number})\n${todos.map(value => { const todo = record(value); return `- [${symbols[String(todo.status)] ?? " "}] ${String(todo.content ?? todo.description ?? "")}`; }).join("\n")}`, cap, partCall(sessionID, latest.number, latest.part));
}

function questionsSection(messages: NumberedMessage[], sessionID: string, cap: number): string {
  const calls = toolCalls(messages, "question").filter(row => row.call.state?.metadata?.answers !== undefined);
  if (!calls.length) return "";
  const rows = calls.flatMap(row => {
    const input = record(row.call.state?.input);
    const answers = row.call.state!.metadata!.answers;
    const questions = Array.isArray(input.questions) ? input.questions : [{ question: input.question ?? "Question" }];
    return questions.map((question, index) => `- #${row.number} ${String(record(question).question ?? "Question")}\n  Answer: ${json(Array.isArray(answers) ? answers[index] : answers)}`);
  });
  return bounded(`## Questions answered\n${rows.join("\n")}`, cap, partCall(sessionID, calls.at(-1)!.number, calls.at(-1)!.part));
}

function subagentsSection(messages: NumberedMessage[], children: SessionInfo[], sessionID: string, cap: number): string {
  const dispatches = subagentDispatches(messages);
  if (!children.length && !dispatches.length) return "";
  const joined = new Set<string>();
  const rows = [...children].sort((a, b) => (Number(b.time?.updated) || 0) - (Number(a.time?.updated) || 0)).map(child => {
    joined.add(child.id);
    const calls = dispatches.filter(dispatch => dispatch.childID === child.id);
    const result = messages.findLast(entry => messageType(entry.message) === "synthetic" && messageText(entry.message).includes(child.id));
    return `- ${child.id} · ${child.agent ?? "unknown"} · ${child.title} · ${child.outcome ?? "unknown"} · ${localTime(child.time?.updated, true)}${calls.length ? ` · dispatch ${numberRanges(calls.map(call => call.number))}: ${calls.at(-1)!.description}` : ""}${result ? ` · result #${result.number}` : ""}`;
  });
  rows.push(...dispatches.filter(dispatch => !dispatch.childID || !joined.has(dispatch.childID)).reverse().map(dispatch => `- dispatch #${dispatch.number} [${dispatch.part}] · ${dispatch.agent} · ${dispatch.description} · ${dispatch.childID ?? "child ID not recorded"} · ${dispatch.call.state?.status ?? "unknown"}`));
  const call = readCall({ sessionID, mode: "slice", from: 1, tool: "subagent", detail: "full" });
  let visible = Math.min(30, rows.length);
  const text = () => `## Subagents\n${rows.slice(0, visible).join("\n")}${rows.length > visible ? `\n+${rows.length - visible} more. Read: ${call}` : ""}`;
  while (visible > 1 && text().length > cap) visible--;
  return bounded(text(), cap, call);
}

function runningSection(messages: NumberedMessage[], sessionID: string, cap: number): string {
  const calls = toolCalls(messages, "compress");
  const compaction = messages.findLast(entry => messageType(entry.message) === "compaction" && Boolean(entry.message.summary));
  if (!calls.length && !compaction) return "";
  const allCall = readCall({ sessionID, mode: "slice", from: 1, tool: "compress", detail: "full", maxChars: 60_000 });
  const footer = calls.length ? `\n\nAll running summaries: ${allCall}` : "";
  let content = "## Running summaries";
  const blocks = calls.flatMap(row => compressBlocks(row.call).map(block => ({ ...block, number: row.number, part: row.part })));
  if (compaction) {
    const size = Math.min(1_500, Math.max(0, Math.floor(cap / (blocks.length ? 4 : 1)) - 150));
    content += `\nLatest compaction (#${compaction.number}):\n${excerpt(compaction.message.summary!, size, partCall(sessionID, compaction.number))}`;
  }
  if (calls.length) {
    const catalogue = calls.map(row => `- #${row.number} [${row.part}] ${compressBlocks(row.call).map(block => block.header).join("; ") || "(empty summary)"}`).join("\n");
    content += `\n${bounded(catalogue, Math.min(1_500, Math.max(0, Math.floor(cap / 3))), allCall)}`;
  }
  for (const [index, block] of [...blocks].reverse().entries()) {
    const full = `\n\n### #${block.number} ${block.header}\n${block.text}`;
    const remaining = cap - content.length - footer.length;
    if (full.length <= remaining) content += full;
    else {
      if (index === 0) content += `\n\n${bounded(`### #${block.number} ${block.header}\n${block.text}`, Math.max(0, remaining - 2), partCall(sessionID, block.number, block.part, undefined, 60_000))}`;
      break;
    }
  }
  return bounded(`${content}${footer}`, cap, allCall);
}

export function renderSummary(loaded: LoadedSession, children: SessionInfo[], maxChars: number): string {
  const sessionID = loaded.session.id;
  const messages = loaded.messages.map((message, index) => ({ message, number: index + 1 }));
  const scale = maxChars / 20_000;
  let head = bounded(header(loaded, messages), Math.min(2_000, Math.max(500, Math.floor(2_000 * scale))), readCall({ sessionID, mode: "summary", maxChars: 60_000 }));
  if (loaded.source === "active-context" && !head.includes(ACTIVE_CONTEXT_NOTICE)) head += `\n${ACTIVE_CONTEXT_NOTICE}`;
  const more = `## Read more\nMessage: ${partCall(sessionID, messages.at(-1)?.number ?? 1)}\nSlice: ${readCall({ sessionID, mode: "slice", from: Math.max(1, messages.length - 19), limit: 20, detail: "full" })}\nSearch: ${readCall({ sessionID, mode: "search", query: "keyword" })}\nTool filter: ${readCall({ sessionID, mode: "slice", from: 1, tool: "compress", detail: "full", maxChars: 60_000 })}`;
  const definitions = [
    { cap: 5_000, render: (cap: number) => promptsSection(messages, sessionID, cap) },
    { cap: 2_000, render: (cap: number) => todoSection(messages, sessionID, cap) },
    { cap: 1_500, render: (cap: number) => questionsSection(messages, sessionID, cap) },
    { cap: 2_500, render: (cap: number) => subagentsSection(messages, children, sessionID, cap) },
    { cap: 2_000, render: (cap: number) => filesSection(messages, sessionID, cap) },
    { cap: 6_000, render: (cap: number) => runningSection(messages, sessionID, cap), running: true },
  ].map(definition => ({ ...definition, cap: Math.floor(definition.cap * scale) })).map(definition => ({ ...definition, preview: definition.render(definition.cap) })).filter(definition => definition.preview);
  const tailReserve = messages.length ? Math.floor(3_000 * scale) : 0;
  let remaining = Math.max(0, maxChars - head.length - more.length - tailReserve - 80);
  const sections = [head];
  for (const [index, definition] of definitions.entries()) {
    const future = definitions.slice(index + 1).reduce((sum, section) => sum + Math.min(section.preview.length, Math.floor((section.running ? 2_000 : 350) * scale)), 0);
    const cap = Math.max(0, Math.min(definition.cap, remaining - future));
    const section = definition.preview.length <= cap ? definition.preview : definition.render(cap);
    if (section) { sections.push(section); remaining -= section.length + 2; }
  }
  if (messages.length) {
    const tail = messages.slice(-12);
    const title = `## Last steps (#${tail[0]!.number}–#${messages.length})`;
    const budget = Math.max(0, maxChars - sections.join("\n\n").length - more.length - title.length - 8);
    const finalAssistant = messages.findLast(entry => messageType(entry.message) === "assistant")?.number;
    sections.push(`${title}\n${renderListing(tail, { sessionID, total: messages.length, maxChars: budget, detail: "brief", finalAssistant }).content}`);
  } else sections.push("No conversation messages in this session.");
  sections.push(more);
  return truncate(sections.join("\n\n"), maxChars);
}
