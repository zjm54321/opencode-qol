// Copied into upstream packages/core/src/plugin/qol/builtin.ts before Bun.build.
// These are server imports, not npm/plugin-loader configuration entries.
import type { Plugin as EffectPlugin } from "@opencode/plugin/effect/plugin"
import type { Plugin as PromisePlugin } from "@opencode/plugin/promise/plugin"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import omo from "./vendor/oh-my-opencode-slim/dist/server/index.js"
import billion from "./vendor/billion-context/dist/agent/opencode-native.js"
import image from "./plugins/image/src/index.ts"
import sessionReader from "./plugins/session-reader/src/index.ts"
import clearEncrypted from "./plugins/clear-encrypted/src/index.ts"
import gptTaste from "./plugins/gpt-taste/index.js"
import modelPolicy from "./plugins/model-policy/index.js"
import desktopBridge from "./plugins/desktop-bridge/src/index.ts"
import bundledMcp from "./plugins/bundled-mcp/src/index.ts"

function adapt(definition: EffectPlugin | PromisePlugin): EffectPlugin {
  const plugin = "effect" in definition ? definition : fromPromise(definition)
  return {
    id: plugin.id,
    effect: (host) => plugin.effect({ ...host, options: host.options ?? {} }),
  }
}

// Append after all resolved upstream post plugins; do not replace either list.
export const QolPlugins: readonly EffectPlugin[] = [
  bundledMcp,
  omo,
  billion,
  image,
  sessionReader,
  clearEncrypted,
  gptTaste,
  modelPolicy,
  desktopBridge,
].map(adapt)
