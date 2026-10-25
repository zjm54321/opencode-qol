// SPDX-License-Identifier: GPL-3.0-or-later

import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { OpenCodeClient } from "./client.js";
import type { Cursor, FileDiff, Page, SessionInfo, SessionMessage } from "./client.js";
import { dehydrate, truncate } from "./dehydrate.js";

const order = z.enum(["asc", "desc"]);
const sessionID = z.string().trim().min(1).describe("The session ID returned by session_list.");
const limit = z.number().int().min(1).max(100).optional();

function sessionHeader(session: SessionInfo): string {
  return `# ${session.title}\n\nSession: ${session.id}\nDirectory: ${session.location?.directory ?? session.directory ?? "unknown"}`;
}

function pagination(cursor: Cursor): string {
  return `\n\nPagination: ${JSON.stringify(cursor)}`;
}

function formatDiff(diffs: FileDiff[]): string {
  if (!diffs.length) return "No file diffs for this session.";
  // Fences longer than file contents prevent an embedded fence from ending the block.
  return truncate(diffs.map(diff => {
    const content = `--- before\n${diff.before}\n+++ after\n${diff.after}`;
    const fence = "`".repeat(Math.max(3, ...Array.from(content.matchAll(/`+/g), match => match[0].length + 1)));
    return `## ${diff.file} (+${diff.additions ?? "?"}/-${diff.deletions ?? "?"})\n\n${fence}text\n${content}\n${fence}`;
  }).join("\n\n"), 24_000);
}

function diffMetadata(sessionID: string, diffs: FileDiff[]) {
  return {
    sessionID,
    files: diffs.length,
    ...(diffs.every(diff => typeof diff.additions === "number") ? { additions: diffs.reduce((sum, diff) => sum + diff.additions!, 0) } : {}),
    ...(diffs.every(diff => typeof diff.deletions === "number") ? { deletions: diffs.reduce((sum, diff) => sum + diff.deletions!, 0) } : {}),
  };
}

export default Plugin.define({
  id: "opencode.qol.session-reader",
  async setup(ctx) {
    const client = new OpenCodeClient();
    const getSessionSafe = async (id: string, signal: AbortSignal): Promise<SessionInfo | undefined> => {
      signal.throwIfAborted();
      if (typeof (ctx as any).session?.get === "function") {
        try {
          const res = await (ctx as any).session.get({ sessionID: id });
          signal.throwIfAborted();
          // An empty native result is authoritative, not a reason to try HTTP.
          return (res && "data" in res ? res.data : res) ?? undefined;
        } catch {
          signal.throwIfAborted();
        }
      }
      try { return (await client.getSession(id, signal)).data; }
      catch {
        signal.throwIfAborted();
        return undefined;
      }
    };
    const getNativeContext = async (id: string, signal: AbortSignal): Promise<SessionMessage[] | undefined> => {
      signal.throwIfAborted();
      if (typeof (ctx as any).session?.context !== "function") return undefined;
      try {
        const res = await (ctx as any).session.context({ sessionID: id });
        signal.throwIfAborted();
        return Array.isArray(res) ? res : res?.data ?? [];
      } catch {
        signal.throwIfAborted();
        return undefined;
      }
    };
    const standaloneDiff = "No file diffs available for this session in standalone mode.";
    const getDiffSafe = async (input: { sessionID: string }, signal: AbortSignal): Promise<FileDiff[] | undefined> => {
      try { return (await client.getSessionDiff(input, signal)).data; }
      catch {
        signal.throwIfAborted();
        if (typeof (ctx as any).session?.diff !== "function") return undefined;
        try {
          const res = await (ctx as any).session.diff({ sessionID: input.sessionID });
          return res?.data ?? res ?? [];
        } catch {
          signal.throwIfAborted();
          return undefined;
        }
      }
    };
    const registration = await ctx.tool.transform(editor => {
      editor.add({
        name: "session_list",
        options: { codemode: false },
        description: "Discover OpenCode sessions, with title search and opaque pagination. Defaults to this directory; search or all=true searches across directories. Explicit directory overrides that scope.",
        input: z.object({
          search: z.string().optional(),
          all: z.boolean().optional(),
          directory: z.string().optional(),
          limit,
          order: order.optional(),
          cursor: z.string().optional(),
        }),
        async execute(input, execution) {
          execution.signal.throwIfAborted();
          const options = {
            search: input.search,
            directory: input.directory ?? (input.all || input.search !== undefined ? undefined : ctx.location?.directory),
            limit: input.limit ?? 20,
            order: input.cursor ? undefined : (input.order ?? "desc"),
            cursor: input.cursor,
          };
          let result: Page<SessionInfo> | undefined;
          if (typeof (ctx as any).session?.list === "function") {
            try {
              const res = await (ctx as any).session.list(options);
              execution.signal.throwIfAborted();
              result = { data: Array.isArray(res) ? res : res?.data ?? [], cursor: res?.cursor ?? {} };
            } catch {
              execution.signal.throwIfAborted();
            }
          }
          if (!result) {
            try { result = await client.listSessions(options, execution.signal); }
            catch {
              execution.signal.throwIfAborted();
              return { content: "[]\n\nSession list is unavailable: neither the background service nor in-process sessions could be read.", metadata: { count: 0, search: input.search, cursor: {}, available: false } };
            }
          }
          const sessions = result.data.map(session => ({
            id: session.id,
            title: session.title,
            directory: session.location?.directory ?? session.directory,
            parentID: session.parentID,
            updated: session.time?.updated,
          }));
          return { content: `${JSON.stringify(sessions, null, 2)}${pagination(result.cursor)}`, metadata: { count: sessions.length, search: input.search, cursor: result.cursor } };
        },
      });

      editor.add({
        name: "session_read",
        options: { codemode: false },
        description: "Read compact session turns without raw tool payloads. Prefers in-process active context: summary reads the last 12 messages; recent reads newest messages chronologically; slice reads in the requested order. HTTP fallback supports full-history pagination with returned cursors. diff reads file changes.",
        input: z.object({
          sessionID,
          mode: z.enum(["summary", "recent", "slice", "diff"]).default("summary"),
          limit,
          cursor: z.string().optional(),
          order: order.optional(),
          type: z.string().optional().describe("Optional message type filter for recent/slice."),
        }),
        async execute(input, execution) {
          if (input.mode === "diff") {
            const diffs = await getDiffSafe(input, execution.signal);
            if (!diffs) return { content: standaloneDiff, metadata: { sessionID: input.sessionID, mode: "diff", available: false } };
            return { content: formatDiff(diffs), metadata: { ...diffMetadata(input.sessionID, diffs), mode: "diff", count: diffs.length } };
          }
          const session = await getSessionSafe(input.sessionID, execution.signal);
          if (!session) {
            return { content: `Session not found: ${input.sessionID}`, metadata: { sessionID: input.sessionID, mode: input.mode, count: 0, available: false } };
          }
          const empty = `${sessionHeader(session)}\n\nNo conversation messages in this session.`;
          const unavailable = () => ({ content: `${sessionHeader(session)}\n\nSession messages are unavailable: neither the background service nor in-process active context could be read.`, metadata: { sessionID: input.sessionID, mode: input.mode, count: 0, available: false } });
          const context = await getNativeContext(input.sessionID, execution.signal);
          if (input.mode === "summary") {
            let active = context;
            if (!active) {
              try { active = (await client.getSessionContext(input.sessionID, execution.signal)).data ?? []; }
              catch {
                execution.signal.throwIfAborted();
                return unavailable();
              }
            }
            const count = input.limit ?? 12;
            const messages = active.slice(-count);
            const omitted = active.length > count ? `\n\nShowing the last ${messages.length} of ${active.length} active-context messages.` : "";
            return { content: messages.length ? `${sessionHeader(session)}${omitted}\n\n${dehydrate(messages) || "No conversation messages in this session."}` : empty, metadata: { sessionID: input.sessionID, title: session.title, mode: input.mode, count: messages.length } };
          }
          if (context) {
            // Active context is chronological but is not a full-history page.
            // Never reuse an HTTP cursor or imply that older history was read.
            const filtered = input.type === undefined ? context : context.filter(message => (message.type ?? message.role ?? message.info?.role) === input.type);
            const count = input.limit ?? 20;
            const messages = input.mode === "recent" || input.order === "desc" ? filtered.slice(-count) : filtered.slice(0, count);
            return {
              content: messages.length ? `${sessionHeader(session)}\n\nIn-process read: showing active context only; full-history pagination is unavailable.\n\n${dehydrate(messages) || "No conversation messages in this session."}` : empty,
              metadata: { sessionID: input.sessionID, title: session.title, mode: input.mode, count: messages.length, cursor: {}, source: "active-context" },
            };
          }
          const requestedOrder = input.cursor ? undefined : (input.mode === "recent" ? "desc" : input.order ?? "asc");
          let result: Page<SessionMessage>;
          try {
            result = await client.getSessionMessages({
              sessionID: input.sessionID,
              limit: input.limit ?? 20,
              order: requestedOrder,
              cursor: input.cursor,
              type: input.type,
            }, execution.signal);
          } catch {
            execution.signal.throwIfAborted();
            return unavailable();
          }
          // Pages retain API ordering; reverse descending pages for prompt-led turn parsing.
          let descending = input.mode === "recent" || input.order === "desc";
          if (input.cursor) {
            try {
              const decoded = JSON.parse(Buffer.from(input.cursor, "base64").toString("utf-8"));
              if (decoded.order === "desc") descending = true;
              else if (decoded.order === "asc") descending = false;
            } catch {}
          }
          const messages = descending ? [...result.data].reverse() : result.data;
          return {
            content: messages.length ? `${sessionHeader(session)}\n\n${dehydrate(messages) || "No conversation messages in this session."}${pagination(result.cursor)}` : empty,
            metadata: { sessionID: input.sessionID, title: session.title, mode: input.mode, count: messages.length, cursor: result.cursor },
          };
        },
      });

      editor.add({
        name: "session_diff",
        options: { codemode: false },
        description: "Read a session's file changes (before/after content, bounded to 24,000 characters). Optionally select a single file.",
        input: z.object({ sessionID, file: z.string().optional() }),
        async execute(input, execution) {
          const diffs = await getDiffSafe({ sessionID: input.sessionID }, execution.signal);
          if (!diffs) return { content: standaloneDiff, metadata: { sessionID: input.sessionID, available: false } };
          const selected = input.file === undefined ? diffs : diffs.filter(diff => diff.file === input.file);
          return { content: formatDiff(selected), metadata: diffMetadata(input.sessionID, selected) };
        },
      });
    });
    return async () => { await registration.dispose(); };
  },
});
