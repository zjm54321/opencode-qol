// SPDX-License-Identifier: GPL-3.0-or-later
export const id = "clear-encrypted"

export type ClearResult = {
  ok: true
  changedMessages: number
  changedEvents: number
  removedFields: number
}

// Portable JSON schema: no SDK/runtime dependencies and no caller-selected paths.
export const definition = {
  id,
  methods: {
    clear: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1 } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { const: true },
          changedMessages: { type: "integer", minimum: 0 },
          changedEvents: { type: "integer", minimum: 0 },
          removedFields: { type: "integer", minimum: 0 },
        },
        required: ["ok", "changedMessages", "changedEvents", "removedFields"],
        additionalProperties: false,
      },
      errors: { failed: { type: "null" } },
    },
  },
  events: {},
} as const

// Never display raw subprocess, provider or RPC error strings (may contain secrets).
export const reasons = {
  arguments: "This command does not accept arguments or attachments",
  compatibility: "Current OpenCode host lacks required clearing interface",
  location: "Unable to determine session location",
  database: "Unable to determine local database",
  runtime: "Standalone Bun runtime is unavailable or incompatible",
  busy: "Clearing operation is already in progress for this session",
  stopped: "Failed to stop or wait for session to end",
  cancelled: "Operation was cancelled or timed out",
  helper: "Clearing process was not confirmed, check database status",
  refresh: "Clear was committed, but UI refresh failed; please reopen session",
  unknown: "Operation failed, please check service status",
} as const

export function safeReason(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : undefined
  return Object.values(reasons).find((value) => value === message) ?? reasons.unknown
}

export default definition
