# Nano Banana Pro (adapted reference)

- Model: `gemini-3-pro-image`, only when enabled in local configuration and explicitly requested. Resolve it through the image model catalog; do not guess replacement IDs on a failure.
- Follow the parent skill and call `experimental_image_generate` with `prompt` and optional `images`. Exact aspect ratio and resolution are model settings/variants; no Python or Interactions API execution is used here.
- Best suited to text-heavy compositions, multi-image fusion and consistent characters. Do not upgrade a simple task by default; stay within the user's authorized cost.
- Label each reference's role explicitly. Pass the approved first image for every related scene; preserve stable facial features, wardrobe, palette and framing in the prompt.
- Hold aspect ratio and resolution fixed for a consistent series. There is no seed argument and a repeated prompt alone does not guarantee identity.
- Wait for the native completion notice, then review the saved image. Pass that image explicitly for follow-up edits; no upstream sidecar or response-ID chaining workflow is required.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
