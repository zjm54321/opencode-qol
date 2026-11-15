// SPDX-License-Identifier: GPL-3.0-or-later

import { OpenCodeClient, ServiceResponseError } from "./client.js";
import type { FileDiff, ListSessionsOptions, Page, SessionInfo, SessionMessage } from "./client.js";

export const ACTIVE_CONTEXT_NOTICE = "Background service unavailable: showing the active context only (messages before the latest compaction are not included).";
const PAGE_SIZE = 200;
const MAX_MESSAGES = 50_000;
const CACHE_SESSIONS = 3;
/** A loaded history can be tens of megabytes and the host process is long-lived: drop what nobody reads any more. */
const CACHE_IDLE_MS = 5 * 60_000;

type NativeResult<T> = T | { data: T } | null | undefined;
export interface NativeSessions {
  get?: (input: { sessionID: string }) => Promise<NativeResult<SessionInfo>>;
  list?: (input: ListSessionsOptions) => Promise<NativeResult<SessionInfo[]> & { cursor?: Page<SessionInfo>["cursor"] }>;
  context?: (input: { sessionID: string }) => Promise<NativeResult<SessionMessage[]>>;
  diff?: (input: { sessionID: string; from?: string; to?: string }) => Promise<NativeResult<FileDiff[]>>;
}

export interface LoadedSession {
  session: SessionInfo;
  messages: SessionMessage[];
  source: "history" | "active-context";
  capped?: boolean;
}

export class SessionNotFoundError extends Error {
  constructor(id: string, readonly native: boolean) { super(`Session not found: ${id}`); }
}

function unwrap<T>(result: NativeResult<T>): T | undefined {
  return result && typeof result === "object" && "data" in result ? result.data : result ?? undefined;
}

/** Native methods can hang even without a service; both cancellation and timeout must win. */
export async function timedNative<T>(call: () => Promise<T>, signal: AbortSignal, timeoutMs = 5_000): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const unavailable = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`In-process session call timed out after ${timeoutMs}ms.`)), timeoutMs);
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(call), unavailable]);
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", onAbort!);
  }
}

export class SessionHistory {
  // Completed loads only: a cancelled or partially loaded history is never cached.
  private readonly cache = new Map<string, { updated: unknown; messages: SessionMessage[]; capped: boolean; used: number }>();
  private sweep: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly client: OpenCodeClient, private readonly native: NativeSessions = {}, private readonly nativeTimeoutMs = 5_000, private readonly cacheIdleMs = CACHE_IDLE_MS) {}

  /** Most recently used last; evicts beyond three sessions and after `cacheIdleMs` without a read. */
  private remember(id: string, entry: { updated: unknown; messages: SessionMessage[]; capped: boolean }): void {
    this.cache.delete(id);
    this.cache.set(id, { ...entry, used: Date.now() });
    if (this.cache.size > CACHE_SESSIONS) this.cache.delete(this.cache.keys().next().value!);
    if (this.sweep) return;
    const schedule = () => {
      this.sweep = setTimeout(() => {
        this.sweep = undefined;
        const cutoff = Date.now() - this.cacheIdleMs;
        for (const [key, value] of this.cache) if (value.used <= cutoff) this.cache.delete(key);
        if (this.cache.size) schedule();
      }, this.cacheIdleMs);
      (this.sweep as { unref?: () => void }).unref?.();
    };
    schedule();
  }

  /** Number of histories currently held in memory. */
  get cached(): number { return this.cache.size; }

  dispose(): void {
    if (this.sweep) clearTimeout(this.sweep);
    this.sweep = undefined;
    this.cache.clear();
  }

  private async fallback<T>(http: () => Promise<T>, native: (() => Promise<T>) | undefined, signal: AbortSignal): Promise<{ value: T; native: boolean }> {
    signal.throwIfAborted();
    try { return { value: await http(), native: false }; }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof ServiceResponseError || !native) throw error;
      return { value: await timedNative(native, signal, this.nativeTimeoutMs), native: true };
    }
  }

  async list(options: ListSessionsOptions, signal: AbortSignal): Promise<Page<SessionInfo> & { source: "history" | "active-context" }> {
    const result = await this.fallback(
      () => this.client.listSessions(options, signal),
      this.native.list && (async () => {
        const result = await this.native.list!(options);
        return { data: unwrap(result) ?? [], cursor: result?.cursor ?? {} };
      }), signal,
    );
    return { ...result.value, source: result.native ? "active-context" : "history" };
  }

  async load(id: string, signal: AbortSignal): Promise<LoadedSession | undefined> {
    let info;
    try {
      info = await this.fallback(
        async () => (await this.client.getSession(id, signal)).data,
        this.native.get && (async () => unwrap(await this.native.get!({ sessionID: id }))), signal,
      );
    } catch (error) {
      if (error instanceof ServiceResponseError && error.status === 404) return undefined;
      throw error;
    }
    if (!info.value) throw new SessionNotFoundError(id, info.native);
    const session = info.value;
    const active = async (): Promise<LoadedSession> => {
      if (!this.native.context) throw new Error("Session messages are unavailable: neither the background service nor in-process active context could be read.");
      try {
        const messages = unwrap(await timedNative(() => this.native.context!({ sessionID: id }), signal, this.nativeTimeoutMs)) ?? [];
        return { session, messages, source: "active-context" };
      } catch (error) {
        signal.throwIfAborted();
        throw new Error(`Session messages are unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (info.native) return active();

    const cached = this.cache.get(id);
    if (cached && cached.updated === session.time?.updated) {
      this.remember(id, cached);
      return { session, messages: cached.messages, source: "history", capped: cached.capped };
    }
    try {
      const messages: SessionMessage[] = [];
      let cursor: string | undefined;
      let capped = false;
      do {
        signal.throwIfAborted();
        const page = await this.client.getSessionMessages({ sessionID: id, limit: PAGE_SIZE, ...(cursor ? { cursor } : { order: "asc" }) }, signal);
        signal.throwIfAborted();
        messages.push(...page.data.slice(0, MAX_MESSAGES - messages.length));
        cursor = page.cursor?.next;
        if (messages.length >= MAX_MESSAGES) { capped = Boolean(cursor || page.data.length > PAGE_SIZE); break; }
        if (page.data.length < PAGE_SIZE) break;
      } while (cursor);
      this.remember(id, { updated: session.time?.updated, messages, capped });
      return { session, messages, source: "history", capped };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ServiceResponseError) throw error;
      return active();
    }
  }

  async children(id: string, signal: AbortSignal): Promise<SessionInfo[]> {
    try { return (await this.client.listSessions({ parentID: id, limit: 200 }, signal)).data; }
    catch { signal.throwIfAborted(); return []; }
  }

  /** `reason` carries the service's own refusal, e.g. "Turn range spans a location change" for a moved session. */
  async diff(loaded: LoadedSession, signal: AbortSignal): Promise<{ diffs?: FileDiff[]; native: boolean; reason?: string }> {
    const users = loaded.messages.filter(message => (message.type ?? message.role ?? message.info?.role) === "user");
    const first = users[0]?.id ?? users[0]?.info?.id;
    const last = users.at(-1)?.id ?? users.at(-1)?.info?.id;
    const options = { sessionID: loaded.session.id, ...(first ? { from: first } : {}), ...(last && last !== first ? { to: last } : {}) };
    try {
      const result = await this.fallback(
        async () => (await this.client.getSessionDiff(options, signal)).data,
        this.native.diff && (async () => unwrap(await this.native.diff!(options)) ?? []), signal,
      );
      return { diffs: result.value, native: result.native };
    } catch (error) { signal.throwIfAborted(); return { native: false, ...(error instanceof ServiceResponseError ? { reason: error.message } : {}) }; }
  }
}
