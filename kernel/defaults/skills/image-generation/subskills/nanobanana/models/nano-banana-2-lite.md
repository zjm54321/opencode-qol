# Nano Banana 2 Lite (adapted reference)

- Model: `gemini-3.1-flash-lite-image`, only when enabled in local configuration.
- Follow the parent skill and call `experimental_image_generate` with `prompt` and optional `images`. Exact aspect ratio and resolution are model settings/variants; resolve this model only if explicitly requested.
- Use for authorized lightweight drafts. Typography and complex multi-reference consistency are weaker than the higher tiers; report those tradeoffs rather than silently escalating cost.
- For “same image, change X,” reuse the approved workspace image as a reference and preserve invariants in the prompt. There is no seed argument.
- When promoting a draft, pass the actual draft pixels as a reference; repeating the prompt does not preserve identity.
- Wait for the native completion notice, then review the saved image. Report a failed job rather than automatically generating again. Do not run upstream Python/Interactions API recipes.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
