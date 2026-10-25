// SPDX-License-Identifier: GPL-3.0-or-later

import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { OpenCodeClient } from "./client.js";
import type { Cursor, FileDiff, SessionInfo } from "./client.js";
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
  id: "session-reader",
  async setup(ctx) {
    const client = new OpenCodeClient();
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
          const result = await client.listSessions({
            search: input.search,
            directory: input.directory ?? (input.all || input.search !== undefined ? undefined : ctx.location.directory),
            limit: input.limit ?? 20,
            order: input.cursor ? undefined : (input.order ?? "desc"),
            cursor: input.cursor,
          }, execution.signal);
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
        description: "Read compact session turns without raw tool payloads. summary reads active context (last 12 messages); recent reads newest messages chronologically; slice pages history in the requested order; diff reads file changes. Use returned cursors for more history.",
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
            const diffs = (await client.getSessionDiff(input, execution.signal)).data;
            return { content: formatDiff(diffs), metadata: { ...diffMetadata(input.sessionID, diffs), mode: "diff", count: diffs.length } };
          }
          const session = (await client.getSession(input.sessionID, execution.signal)).data;
          if (input.mode === "summary") {
            const context = (await client.getSessionContext(input.sessionID, execution.signal)).data;
            const count = input.limit ?? 12;
            const messages = context.slice(-count);
            const omitted = context.length > count ? `\n\nShowing the last ${messages.length} of ${context.length} active-context messages.` : "";
            return { content: `${sessionHeader(session)}${omitted}\n\n${dehydrate(messages) || "No conversation messages."}`, metadata: { sessionID: input.sessionID, title: session.title, mode: input.mode, count: messages.length } };
          }
          const requestedOrder = input.cursor ? undefined : (input.mode === "recent" ? "desc" : input.order ?? "asc");
          const result = await client.getSessionMessages({
            sessionID: input.sessionID,
            limit: input.limit ?? 20,
            order: requestedOrder,
            cursor: input.cursor,
            type: input.type,
          }, execution.signal);
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
            content: `${sessionHeader(session)}\n\n${dehydrate(messages) || "No conversation messages."}${pagination(result.cursor)}`,
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
          const diffs = (await client.getSessionDiff(input, execution.signal)).data;
          const selected = input.file === undefined ? diffs : diffs.filter(diff => diff.file === input.file);
          return { content: formatDiff(selected), metadata: diffMetadata(input.sessionID, selected) };
        },
      });
    });
    return async () => { await registration.dispose(); };
  },
});
