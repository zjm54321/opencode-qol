# Native Image Settings Reference

Adapted from OpenAI's image API reference for OpenCode 2.2.5. Execution uses `experimental_image_generate`; provider endpoints and request encoding are handled by OpenCode, not by the agent.

## Tool inputs

The native tool accepts `prompt`, optional `images`, optional `model`, and optional `path`. Each call produces one image asynchronously. See the parent skill for model selection, reference limits, and completion handling.

## OpenAI model settings

Provider/model `settings` and variant `settings` can supply supported output controls, including:

- `size`: a size accepted by the selected model, for example `1024x1024`, `1536x1024`, or `1024x1536`.
- `quality`: a quality supported by the selected model.
- `background`: for example `transparent` when supported; this is an output property, distinct from a scene description.
- `outputFormat`: the output encoding, such as `png`.

These are configuration fields, not additional native tool arguments. Check the configured model and gateway support before promising an exact output property. A variant reference uses `providerID/modelID#variant` and should be selected only when explicitly requested by the user.

## Edits and output

Pass source images in `images` and state the requested changes and invariants in the prompt. The tool exposes neither a mask parameter nor arbitrary underlying API controls. Do not work around a missing tool parameter with a standalone SDK request.

Wait for the automatic completion notice, then read the actual saved image. The immediate job ID/path stem is not a finished image or a Markdown preview. On failure, report the actionable error; do not automatically issue another billable request.
