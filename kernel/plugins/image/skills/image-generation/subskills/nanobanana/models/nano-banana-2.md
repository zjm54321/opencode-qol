# Nano Banana 2 (adapted reference)

- Model: `gemini-3.1-flash-image`, only when enabled in local configuration.
- Call the direct built-in `image_gen_nano` tool. It uses Gemini native `:generateContent`, not an SDK or the Interactions API.
- General-purpose generation, detail and readable text. Use `aspect_ratio`, `resolution` and references within the configured preset limits.
- Label references by role, quote on-image text verbatim and inspect spelling. For complex multi-reference fusion or character series, consider an enabled Pro model only within the user's requirements and cost authorization.
- For draft promotion, pass the approved draft as a reference alongside the original prompt. Identity does not transfer automatically across models; there is no seed argument.
- Use returned workspace files and metadata. Text-only/empty output is a real tool failure. Continuity via `session_id` is in-memory; explicit references survive restarts.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
