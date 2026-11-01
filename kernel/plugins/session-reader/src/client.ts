// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Order = "asc" | "desc";
export interface Cursor { previous?: string; next?: string }
export interface Page<T> { data: T[]; cursor: Cursor }
export interface Data<T> { data: T }

/** JSON wire types, not the SDK's decoded Effect DateTime values. */
export interface SessionInfo {
  id: string;
  title: string;
  parentID?: string;
  location?: { directory: string; workspaceID?: string };
  directory?: string;
  time?: { created: number; updated: number; archived?: number };
  [key: string]: unknown;
}

export interface MessagePart {
  type: string;
  text?: string;
  name?: string;
  tool?: string;
  state?: { status: string; error?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SessionMessage {
  id?: string;
  type?: string;
  role?: string;
  text?: string;
  content?: string | MessagePart[];
  parts?: MessagePart[];
  info?: { id?: string; role?: string };
  status?: string;
  summary?: string;
  recent?: string;
  error?: unknown;
  exit?: number;
  [key: string]: unknown;
}

export interface FileDiff {
  file: string;
  before: string;
  after: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface ListSessionsOptions {
  search?: string;
  limit?: number;
  directory?: string;
  cursor?: string;
  order?: Order;
}

export interface SessionMessagesOptions {
  sessionID: string;
  limit?: number;
  order?: Order;
  cursor?: string;
  type?: string;
}

export interface ServiceRegistration { url: string; password?: string }

/** The CLI's channel-specific registration lives in state, not its saved configuration. */
export async function readServiceRegistration(
  stateDirectory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode"),
  channel = "latest",
): Promise<ServiceRegistration> {
  const filename = ["latest", "dev", "beta", "next"].includes(channel)
    ? "service.json"
    : `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
  const path = join(stateDirectory, filename);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`OpenCode service registration not found at ${path}. Start the OpenCode background service first.`);
    }
    throw new Error(`Cannot read OpenCode service registration at ${path}.`);
  }
  let registration: Record<string, unknown> | null;
  try {
    registration = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in OpenCode service registration at ${path}.`);
  }
  if (!registration || typeof registration.url !== "string" || !Number.isInteger(registration.pid) || Number(registration.pid) <= 0
    || (registration.password !== undefined && typeof registration.password !== "string")
    || (registration.id !== undefined && typeof registration.id !== "string")
    || (registration.version !== undefined && typeof registration.version !== "string")) {
    throw new Error(`Invalid OpenCode service registration at ${path}: expected url, positive pid and optional string credentials.`);
  }
  let url: URL;
  try {
    url = new URL(registration.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new Error(`Invalid OpenCode service URL in registration at ${path}: expected an HTTP(S) URL without embedded credentials.`);
  }
  return { url: url.href, password: registration.password as string | undefined };
}

/** Omits only absent values; URLSearchParams safely encodes paths, searches and cursors. */
export function formatOptions(options: Record<string, string | number | undefined>): URLSearchParams {
  return new URLSearchParams(Object.entries(options).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
}

export interface ClientOptions {
  stateDirectory?: string;
  channel?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class OpenCodeClient {
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly options: ClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 2_500;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("timeoutMs must be a positive finite number.");
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  listSessions(opts: ListSessionsOptions = {}, signal?: AbortSignal): Promise<Page<SessionInfo>> {
    return this.get("/api/session", { ...opts }, signal);
  }

  getSession(sessionID: string, signal?: AbortSignal): Promise<Data<SessionInfo>> {
    return this.get(this.sessionPath(sessionID), {}, signal);
  }

  getSessionMessages(opts: SessionMessagesOptions, signal?: AbortSignal): Promise<Page<SessionMessage>> {
    const { sessionID, ...query } = opts;
    return this.get(`${this.sessionPath(sessionID)}/message`, query, signal);
  }

  getSessionDiff(opts: { sessionID: string }, signal?: AbortSignal): Promise<Data<FileDiff[]>> {
    return this.get(`${this.sessionPath(opts.sessionID)}/diff`, {}, signal);
  }

  getSessionContext(sessionID: string, signal?: AbortSignal): Promise<Data<SessionMessage[]>> {
    return this.get(`${this.sessionPath(sessionID)}/context`, {}, signal);
  }

  private sessionPath(sessionID: string): string {
    if (!sessionID.trim()) throw new Error("sessionID must not be empty.");
    return `/api/session/${encodeURIComponent(sessionID)}`;
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    // Reload on each request so a restarted service's URL/password is picked up.
    const registration = await readServiceRegistration(this.options.stateDirectory, this.options.channel);
    const url = new URL(path, registration.url);
    url.search = formatOptions(query).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const authorization = registration.password === undefined ? undefined : Buffer.from(`opencode:${registration.password}`).toString("base64");
    const redact = (value: string) => {
      if (authorization === undefined) return value;
      const clean = value.replaceAll(authorization, "[redacted]");
      return registration.password ? clean.replaceAll(registration.password, "[redacted]") : clean;
    };
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(authorization === undefined ? {} : { Authorization: `Basic ${authorization}` }),
        },
        signal: requestSignal,
        redirect: "error",
      });
      if (!response.ok) {
        const text = redact(await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
        const hint = response.status === 401 || response.status === 403 ? " Check the OpenCode service credentials." : "";
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}.${hint}`);
      }
      try {
        return await response.json() as T;
      } catch (error) {
        if (requestSignal.aborted) throw error;
        throw new Error("The service returned invalid JSON.");
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (controller.signal.aborted) throw new Error(`OpenCode GET ${path} timed out after ${this.timeoutMs}ms.`);
      throw new Error(`OpenCode GET ${path} failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
