// SPDX-License-Identifier: GPL-3.0-or-later

import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { OpenCodeClient } from "./client.js";
import type { FileDiff } from "./client.js";
import { ACTIVE_CONTEXT_NOTICE, SessionHistory, SessionNotFoundError } from "./history.js";
import type { LoadedSession, NativeSessions } from "./history.js";
import { errorText, isoTime, readCall, truncate } from "./dehydrate.js";
import { filterMessages, renderListing, renderMessagePage, renderSearch } from "./render.js";
import { filesSection, renderSummary } from "./summary.js";

const sessionID = z.string().trim().min(1).describe("The session ID returned by session_list.");
const limit = z.number().int().min(1).max(200).optional();
export const messageTypes = z.enum(["agent-switched", "model-switched", "location-switched", "user", "synthetic", "system", "skill", "shell", "assistant", "compaction", "idle"]);
export const sessionReadInput = z.object({
  sessionID,
  mode: z.enum(["summary", "recent", "slice", "message", "search", "diff"]).default("summary"),
  limit,
  from: z.number().int().min(1).optional().describe("1-based stored-history message number; slice starts here, before applying filters."),
  detail: z.enum(["brief", "full"]).default("brief"),
  type: messageTypes.optional().describe("Filter message type (not part type; use assistant, not text)."),
  tool: z.string().trim().min(1).optional().describe("Keep only calls of this tool, with full inputs and outputs."),
  message: z.union([z.number().int().min(1), z.string().trim().min(1)]).optional().describe('Message number, "#37", or message ID, for mode=message.'),
  part: z.number().int().min(1).optional().describe("1-based part index inside the selected message."),
  offset: z.number().int().min(0).optional().describe("Character offset into the selected part's output or text."),
  query: z.string().optional().describe("Case-insensitive substring for mode=search."),
  maxChars: z.number().int().min(2_000).max(60_000).default(20_000),
}).strict();

function invalidCombination(input: z.infer<typeof sessionReadInput>): string | undefined {
  if (input.from !== undefined && input.mode !== "slice") return "from is only used with mode=slice.";
  if (input.message !== undefined && input.mode !== "message") return "message is only used with mode=message.";
  if (input.mode === "message" && input.message === undefined) return "mode=message requires message (a number, #number, or message ID).";
  if ((input.part !== undefined || input.offset !== undefined) && input.mode !== "message") return "part and offset require mode=message.";
  if (input.offset !== undefined && input.part === undefined) return "offset requires a selected part.";
  if (input.query !== undefined && input.mode !== "search") return "query is only used with mode=search.";
  if (input.mode === "search" && !input.query?.trim()) return "mode=search requires non-empty query text.";
  if ((input.type || input.tool) && !["recent", "slice", "search"].includes(input.mode)) return "type and tool filters apply to recent, slice or search.";
  return undefined;
}

function formatDiff(diffs: FileDiff[], sessionID: string, maxChars: number): string {
  const text = diffs.map(diff => {
    const content = `--- before\n${diff.before}\n+++ after\n${diff.after}`;
    const fence = "`".repeat(Math.max(3, ...Array.from(content.matchAll(/`+/g), match => match[0].length + 1)));
    return `## ${diff.file} (+${diff.additions ?? "?"}/-${diff.deletions ?? "?"})\n\n${fence}text\n${content}\n${fence}`;
  }).join("\n\n");
  if (text.length <= maxChars) return text;
  const marker = `\n… [${text.length} chars total; diff truncated]. Read: ${readCall({ sessionID, mode: "diff", maxChars: 60_000 })}`;
  return `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`.slice(0, maxChars);
}

function diffMetadata(sessionID: string, diffs: FileDiff[]) {
  return {
    sessionID, files: diffs.length,
    ...(diffs.every(diff => typeof diff.additions === "number") ? { additions: diffs.reduce((sum, diff) => sum + diff.additions!, 0) } : {}),
    ...(diffs.every(diff => typeof diff.deletions === "number") ? { deletions: diffs.reduce((sum, diff) => sum + diff.deletions!, 0) } : {}),
  };
}

export function createSessionReaderPlugin(options: { nativeTimeoutMs?: number } = {}) {
  const nativeTimeoutMs = options.nativeTimeoutMs ?? 5_000;
  if (!Number.isFinite(nativeTimeoutMs) || nativeTimeoutMs <= 0) throw new Error("nativeTimeoutMs must be a positive finite number.");
  return Plugin.define({
    id: "opencode.qol.session-reader",
    async setup(ctx) {
      const history = new SessionHistory(new OpenCodeClient({ channel: ctx.app.channel }), (ctx as unknown as { session?: NativeSessions }).session, nativeTimeoutMs);
      const unavailable = (id: string, mode: string, error?: unknown, maxChars = 20_000) => toolResult(
        truncate(error instanceof SessionNotFoundError ? `${error.message}${error.native ? `\n${ACTIVE_CONTEXT_NOTICE}` : ""}` : error ? `Session read is unavailable: ${id}\n${errorText(error)}` : `Session not found: ${id}`, maxChars),
        { sessionID: id, mode, count: 0, available: false },
      );
      const diff = async (loaded: LoadedSession, signal: AbortSignal, maxChars: number, file?: string) => {
        const result = await history.diff(loaded, signal);
        const selected = result.diffs?.filter(row => file === undefined || row.file === file) ?? [];
        const notice = loaded.source === "active-context" || result.native ? `${ACTIVE_CONTEXT_NOTICE}\n\n` : "";
        let content: string;
        if (selected.length) content = formatDiff(selected, loaded.session.id, maxChars - notice.length);
        else {
          const files = filesSection(loaded.messages.map((message, index) => ({ message, number: index + 1 })), loaded.session.id, Math.min(2_000, maxChars - notice.length - 150), file);
          const hint = result.diffs === undefined ? result.reason ? `Snapshot diffs are unavailable for this session: ${result.reason.slice(0, 240)}` : "Snapshot diffs are unavailable: the background service could not be read." : file && result.diffs.length ? `No snapshot diff is recorded for ${file}.` : "Snapshot diffs are not recorded for this session.";
          content = `${hint}${files ? `\n\n${files}` : ""}`;
        }
        return { content: truncate(`${notice}${content}`, maxChars), metadata: { ...diffMetadata(loaded.session.id, selected), ...(result.diffs === undefined ? { available: false } : {}), source: loaded.source } };
      };
      const registration = await ctx.tool.transform(editor => {
        editor.add({
          name: "session_list", options: { codemode: false },
          description: "Discover OpenCode sessions with title search and opaque pagination. parentID lists a session's subagent sessions (use the literal string null for root sessions). Defaults to this directory; search, parentID or all=true searches across directories. Explicit directory overrides that scope.",
          input: z.object({ search: z.string().optional(), all: z.boolean().optional(), directory: z.string().optional(), parentID: z.string().optional(), limit, order: z.enum(["asc", "desc"]).optional(), cursor: z.string().optional() }),
          async execute(input, execution) {
            execution.signal.throwIfAborted();
            const opts = { search: input.search, directory: input.directory ?? (input.all || input.search !== undefined || input.parentID !== undefined ? undefined : ctx.location?.directory), parentID: input.parentID, limit: input.limit ?? 20, order: input.cursor ? undefined : input.order ?? "desc", cursor: input.cursor };
            try {
              const result = await history.list(opts, execution.signal);
              const rows = result.data.map(session => ({ id: session.id, title: session.title, directory: session.location?.directory ?? session.directory ?? "unknown", parentID: session.parentID ?? null, agent: session.agent ?? null, outcome: session.outcome ?? null, created: isoTime(session.time?.created), updated: isoTime(session.time?.updated) }));
              return toolResult(`${JSON.stringify(rows, null, 2)}\n\nPagination: ${jsonCursor(result.cursor)}${result.source === "active-context" ? `\n${ACTIVE_CONTEXT_NOTICE}` : ""}`, { count: rows.length, search: input.search, parentID: input.parentID, cursor: result.cursor ?? {}, source: result.source });
            } catch (error) {
              execution.signal.throwIfAborted();
              return toolResult(`[]\n\nSession list is unavailable: neither the background service nor in-process sessions could be read.\n${errorText(error)}`, { count: 0, cursor: {}, available: false });
            }
          },
        });
        editor.add({
          name: "session_read", options: { codemode: false },
          description: "Read any session's stored history, including tool inputs/outputs, reasoning and subagent results — full history, also before a compaction. mode=summary (default): resume brief (title, directory, how it ended, every user prompt, latest todo list, question answers, subagent sessions, files written, running summaries, last steps). mode=recent|slice: messages by 1-based number; detail=full adds payloads; type filters message type; tool keeps only calls of one tool and prints them in full. mode=message: one message or one part in full (offset pages long payloads). mode=search: find text anywhere in the history. mode=diff: file changes. Everything needed to resume is available here; reading the OpenCode database is unnecessary.",
          input: sessionReadInput,
          async execute(raw, execution) {
            execution.signal.throwIfAborted();
            const parsed = sessionReadInput.safeParse(raw);
            if (!parsed.success) return toolResult(`Invalid session_read input: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ").slice(0, 500)}`, { available: false, count: 0 });
            const input = parsed.data;
            const invalid = invalidCombination(input);
            if (invalid) return toolResult(invalid, { sessionID: input.sessionID, mode: input.mode, count: 0, available: false });
            let loaded;
            try { loaded = await history.load(input.sessionID, execution.signal); }
            catch (error) { execution.signal.throwIfAborted(); return unavailable(input.sessionID, input.mode, error, input.maxChars); }
            if (!loaded) return unavailable(input.sessionID, input.mode, undefined, input.maxChars);
            const metadata = { sessionID: input.sessionID, title: loaded.session.title, mode: input.mode, total: loaded.messages.length, source: loaded.source };
            if (input.mode === "diff") { const result = await diff(loaded, execution.signal, input.maxChars); return toolResult(result.content, { ...metadata, ...result.metadata, count: result.metadata.files }); }
            if (input.mode === "summary") {
              const children = loaded.source === "history" ? await history.children(input.sessionID, execution.signal) : [];
              return toolResult(renderSummary(loaded, children, input.maxChars), { ...metadata, count: loaded.messages.length });
            }
            const heading = `# ${loaded.session.title}\nSession: ${input.sessionID}\nDirectory: ${loaded.session.location?.directory ?? loaded.session.directory ?? "unknown"}${loaded.source === "active-context" ? `\n${ACTIVE_CONTEXT_NOTICE}` : ""}${loaded.capped ? "\nHistory safety cap reached: showing the first 50,000 stored messages." : ""}`;
            const maxChars = Math.max(0, input.maxChars - heading.length - 2);
            const numbered = loaded.messages.map((message, index) => ({ message, number: index + 1 }));
            const finish = (content: string, extra: Record<string, unknown>) => toolResult(truncate(`${heading}\n\n${content}`, input.maxChars), { ...metadata, ...extra });
            if (input.mode === "message") {
              const number = typeof input.message === "number" ? input.message : /^#[1-9]\d*$/.test(input.message!) ? Number(input.message!.slice(1)) : undefined;
              const entry = number === undefined ? numbered.find(row => (row.message.id ?? row.message.info?.id) === input.message) : numbered[number - 1];
              if (!entry) return finish(`Message not found: ${input.message}. This history has ${numbered.length} messages.`, { count: 0 });
              return finish(renderMessagePage(entry, { sessionID: input.sessionID, part: input.part, offset: input.offset, maxChars, callMaxChars: input.maxChars }), { count: 1, message: entry.number });
            }
            const filtered = filterMessages(numbered, input.type, input.tool);
            if (input.mode === "search") {
              const result = renderSearch(filtered, { sessionID: input.sessionID, tool: input.tool, query: input.query!, limit: input.limit ?? 20, maxChars });
              return finish(result.content, { count: result.count, hits: result.hits });
            }
            const selected = input.mode === "recent" ? filtered.slice(-(input.limit ?? 20)) : filtered.filter(row => row.number >= (input.from ?? 1)).slice(0, input.limit ?? 20);
            const result = renderListing(selected, { sessionID: input.sessionID, detail: input.detail, tool: input.tool, type: input.type, total: numbered.length, maxChars, callMaxChars: input.maxChars });
            return finish(numbered.length ? result.content : "No conversation messages in this session.", { count: result.count, ...(result.stoppedAt ? { stoppedAt: result.stoppedAt } : {}) });
          },
        });
        editor.add({
          name: "session_diff", options: { codemode: false },
          description: "Read a whole session's snapshot-tracked file changes (first through last user turn, bounded to 24,000 characters). Optionally select a file. If snapshots are not recorded, lists files written/edited from tool inputs instead.",
          input: z.object({ sessionID, file: z.string().optional() }),
          async execute(input, execution) {
            execution.signal.throwIfAborted();
            try {
              const loaded = await history.load(input.sessionID, execution.signal);
              if (!loaded) return unavailable(input.sessionID, "diff");
              const result = await diff(loaded, execution.signal, 24_000, input.file);
              return toolResult(result.content, result.metadata);
            } catch (error) { execution.signal.throwIfAborted(); return unavailable(input.sessionID, "diff", error, 24_000); }
          },
        });
      });
      return async () => { await registration.dispose(); history.dispose(); };
    },
  });
}

function jsonCursor(cursor: unknown): string { return JSON.stringify(cursor ?? {}); }

/**
 * The host persists tool metadata as JSON. A single `undefined` value fails that schema, the result is dropped
 * ("Tool result missing") and the call stays "running": session_list did this on every call without `search`.
 */
export function toolResult(content: string, metadata: Record<string, unknown>): { content: string; metadata: Record<string, unknown> } {
  return { content: content || "(no content)", metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown> };
}
export default createSessionReaderPlugin();
