# Nano Banana Pro (adapted reference)

- Model: `gemini-3-pro-image`, only when enabled in local configuration. Do not guess replacement IDs on a 404; consult the error, allowlist and official documentation.
- Call the direct built-in `image_gen_nano` tool with supported `prompt`, references, `aspect_ratio`, `resolution` and optional `session_id` parameters. No Python or Interactions API execution is used here.
- Best suited to text-heavy compositions, multi-image fusion and consistent characters. Do not upgrade a simple task by default; stay within the user's authorized cost.
- Label each reference's role explicitly. Pass the approved first image for every related scene; preserve stable facial features, wardrobe, palette and framing in the prompt.
- Hold aspect ratio and resolution fixed for a consistent series. There is no seed argument and a repeated prompt alone does not guarantee identity.
- The tool returns saved workspace file links and count metadata; text-only/empty responses fail. No upstream sidecar or response-ID chaining workflow is required.

Upstream technical context: https://ai.google.dev/gemini-api/docs/image-generation ; current pricing: https://ai.google.dev/gemini-api/docs/pricing . Attribution: `../LICENSE`, `../SOURCE`.
