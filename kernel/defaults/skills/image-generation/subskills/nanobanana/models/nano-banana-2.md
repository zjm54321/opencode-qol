# Nano Banana 2 (adapted reference)

- Model: `gemini-3.1-flash-image`, only when enabled in local configuration.
- Follow the parent skill and call `experimental_image_generate`; use `images` for references. Resolve this model only if the user explicitly requests it.
- General-purpose generation, detail and readable text. Exact aspect ratio and resolution belong in configured model settings/variants, not tool arguments.
- Label references by role, quote on-image text verbatim and inspect spelling. For complex multi-reference fusion or character series, consider an enabled Pro model only within the user's requirements and cost authorization.
- For draft promotion, pass the approved draft as a reference alongside the original prompt. Identity does not transfer automatically across models; there is no seed argument.
- Wait for the native completion notice, then review the saved image. For continuity, pass the preceding result explicitly in `images`; no plugin continuity ID is used.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
