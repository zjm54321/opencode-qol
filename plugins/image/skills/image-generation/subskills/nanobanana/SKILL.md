---
name: nanobanana
description: Gemini image prompting and reference continuity through the built-in image_gen_nano tool.
---

# Nano Banana image guidance (adapted)

Adapted from Antonio Cárdenas / yeou.dev's generate-nanobanana skill. Retained attribution is in `LICENSE` and `SOURCE`; original source hashes are in `../../upstreams.json`.

## Execution

- Call the direct built-in `image_gen_nano` tool, not `execute`, a shell script or an SDK runner. The compiled-in implementation needs no npm/Python installation or standalone skill update.
- Credentials come from OpenCode's image/provider configuration, `GEMINI_API_KEY` or `GOOGLE_API_KEY`. Never print credentials or ask for them in chat.
- The implementation uses Gemini native `:generateContent` with multimodal `parts` and inline image outputs, not the Interactions API.
- Only enabled models are available. Respect tool errors and the returned model allowlist; do not guess IDs or change configuration automatically.
- Outputs are saved to `.opencode/generated-images/nano/` within the workspace and returned as Markdown links with file/count metadata. Text-only, blocked or empty responses are failures, not generated images.
- Every provider call can be billable. Stay within the user's authorized generation and cost scope; do not generate speculative drafts or parallel batches.
- Video is not supported by these image tools.

## Model guidance

Use configured presets and the tool schema for actual limits and available models:

- [Nano Banana 2 Lite](models/nano-banana-2-lite.md): lightweight drafts when authorized; weaker typography and reference consistency.
- [Nano Banana 2](models/nano-banana-2.md): general-purpose image generation and readable text.
- [Nano Banana Pro](models/nano-banana-pro.md): text-heavy compositions, multi-reference fusion and consistent characters.

## Prompts and references

1. State the subject, intended use, exact text, visual style, composition, lighting, aspect ratio and constraints.
2. Label each reference by index and role: subject identity, style, layout, edit target or palette. Pass its workspace path in `referenced_image_paths`.
3. For edits, specify the delta and invariants: “change only the background; preserve the face, pose, product label and camera angle.”
4. For character series, describe stable features and wardrobe, name the intended camera angle and reuse an approved reference in every scene.
5. For typography, quote exact text and specify hierarchy, placement and legibility; inspect spelling before accepting an output.
6. Keep aspect ratio and resolution fixed across related images. Generations are not deterministic: approved pixels are stronger continuity anchors than repeating words.
7. Pass an approved draft as a reference when changing models; identity does not transfer automatically.

`session_id` reuses the preceding generated image and thought signature for that continuity ID within the current OpenCode conversation, workspace, endpoint and model. It is in-memory only and resets on plugin restart; use explicit references to resume. A failed generation does not advance continuity. No upstream sidecars, reference-folder copying or `previous_interaction_id` workflow is implemented.

Inspect returned images and report the actual saved paths. On failure, report the actionable error; do not replace it with a success summary or silently switch to a shell/SDK.
