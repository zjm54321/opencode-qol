// SPDX-License-Identifier: GPL-3.0-or-later
import { definition, id, reasons, safeReason, type ClearResult } from "./rpc"

type Location = { directory: string; workspaceID?: string }
export interface TuiContext {
  app: { version: string }
  keymap: { layer(factory: () => { mode: "global"; commands: { id: string; title: string; palette: true; run(input?: string): Promise<void> }[] }): void }
  ui: {
    router: { current(): { type: string; sessionID?: string } }
    toast: { show(input: { message: string; variant: "info" | "success" | "error"; sessionID?: string }): void }
  }
  data: { session: {
    get(id: string): { location: Location } | undefined
    message: { invalidate(id: string): void; sync(id: string): Promise<void> }
  } }
  client: { rpc(schema: typeof definition): { clear(input: { sessionID: string }, options: { location: Location }): Promise<unknown> } }
}

export default {
  id,
  setup(ctx: TuiContext) {
    if (typeof ctx?.keymap?.layer !== "function") throw new Error(reasons.compatibility)
    const pending = new Set<string>()
    ctx.keymap.layer(() => ({
      mode: "global",
      // Palette shortcut only: the server command owns /clear-encrypted-contents.
      commands: [{
        id,
        title: "Clear encrypted reasoning content in current session",
        palette: true,
        async run(input?: string) {
          // Missing operational APIs must not prevent registration of the shortcut.
          // Without toast there is no safe UI reporting channel; reject with fixed text.
          if (typeof ctx.ui?.toast?.show !== "function") throw new Error(reasons.compatibility)
          if (typeof ctx.ui?.router?.current !== "function" || typeof ctx.data?.session?.get !== "function"
            || typeof ctx.client?.rpc !== "function" || typeof ctx.data?.session?.message?.invalidate !== "function"
            || typeof ctx.data?.session?.message?.sync !== "function") {
            ctx.ui.toast.show({ message: `Clear incomplete: ${reasons.compatibility}`, variant: "error" })
            return
          }
          const route = ctx.ui.router.current()
          const sessionID = route?.type === "session" && typeof route.sessionID === "string" && route.sessionID.trim()
            ? route.sessionID : undefined
          const stored = sessionID ? ctx.data.session.get(sessionID)?.location : undefined
          const location = stored ? { ...stored } : undefined
          const toast = (message: string, variant: "info" | "success" | "error") =>
            ctx.ui.toast.show({ message, variant, ...(sessionID ? { sessionID } : {}) })
          if (input?.trim()) return toast(reasons.arguments, "error")
          if (!sessionID) return toast("No active session on current page", "error")
          if (typeof location?.directory !== "string" || !location.directory.startsWith("/")
            || (location.workspaceID !== undefined && (typeof location.workspaceID !== "string" || !location.workspaceID.trim())))
            return toast(`Clear incomplete: ${reasons.location}`, "error")
          if (pending.has(sessionID)) return toast(`Clear incomplete: ${reasons.busy}`, "error")
          pending.add(sessionID)
          toast("Stopping current session and clearing encrypted reasoning content...", "info")
          try {
            const rpc = ctx.client.rpc(definition)
            if (typeof rpc?.clear !== "function") throw new Error(reasons.compatibility)
            const committed = await rpc.clear({ sessionID }, { location }) as ClearResult
            toast(committed.removedFields === 0
              ? "No encrypted reasoning fields to clear in the current session"
              : `Cleared encrypted reasoning content while preserving chat history.\nMessages: ${committed.changedMessages}, events: ${committed.changedEvents}, fields: ${committed.removedFields}`, "success")
            // Refresh is best-effort: a stalled sync must not hide the confirmed
            // commit or keep this command pending. Capture this result/session.
            void Promise.resolve().then(async () => {
              ctx.data.session.message.invalidate(sessionID)
              await ctx.data.session.message.sync(sessionID)
            }).catch(() => {
              toast(reasons.refresh, "error")
            })
          } catch (error) {
            toast(`Clear incomplete: ${safeReason(error)}`, "error")
          } finally {
            pending.delete(sessionID)
          }
        },
      }],
    }))
  },
}
