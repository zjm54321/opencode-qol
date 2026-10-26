# Nano Banana 2 Lite (adapted reference)

- Model: `gemini-3.1-flash-lite-image`, only when enabled in local configuration.
- Call the direct built-in `image_gen_nano` tool with `prompt`, optional `referenced_image_paths`, `aspect_ratio` and `resolution`; use its schema and configured preset limits.
- Use for authorized lightweight drafts. Typography and complex multi-reference consistency are weaker than the higher tiers; report those tradeoffs rather than silently escalating cost.
- For “same image, change X,” reuse the approved workspace image as a reference and preserve invariants in the prompt. There is no seed argument.
- When promoting a draft, pass the actual draft pixels as a reference; repeating the prompt does not preserve identity.
- The tool decodes native Gemini inline image data and saves files. A text-only result is a failure, not an image. Do not run upstream Python/Interactions API recipes.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
