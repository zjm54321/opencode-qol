---
name: image-generation
description: "Create or edit images with OpenCode's native image tool. Use for user-requested illustrations, visual assets, icons, mockups, image transformations, or reference-based edits."
---

# Native Image Generation

Use OpenCode's `experimental_image_generate` for execution. This skill adds prompting and reference-image guidance; model discovery, authentication, generation, and background jobs belong to OpenCode.

## Establish the image request

Generate or edit only when the user asks for an image. If an image would help another task, ask before generating it. Identify the subject, intended use, composition, exact text, and constraints that affect the result. Make ordinary visual choices without an interview; ask when a missing requirement would materially change the deliverable.

For edits, separate the requested changes from the features to preserve. Reference images can establish identity, composition, style, or the source to edit; say which role each one has. Use explicit paths or URLs, not an implicit conversation-history selector.

## Models and presets

Normally omit `model` and let OpenCode choose its configured image model. Set it only when the user explicitly requests a particular image model or variant. Look up the exact reference with the `models` tool, using `type: "image"` and filtering to the requested provider when known; do not invent model IDs. The reference is `providerID/modelID` or `providerID/modelID#variant`.

If the image tool is unavailable, check the image model catalog. An empty catalog needs a configured image model under `providers.<provider>.models` with `type: "image"`, appropriate input/output capabilities, and working provider credentials. The preferred default belongs in `experimental.image_generate.model`. Report the missing configuration without reading out credentials or silently changing configuration.

The native tool has no per-call size, aspect-ratio, quality, resolution, or transparency fields. Exact output controls belong in provider model `settings` or configured variants. For example, OpenAI image settings can include `size`, `quality`, and `background`; Google settings can include `imageConfig.aspectRatio` and `imageConfig.imageSize`. A visual instruction in the prompt is useful guidance, not a substitute for an exact API setting. If a required setting is unavailable, resolve the model/preset choice with the user before generating. Do not silently substitute an opaque image for a required transparent asset.

## Build the prompt

Put the intended deliverable first, followed by subject, composition, style, lighting, palette, and essential details. Quote any text that must appear verbatim. State exclusions and invariants explicitly, especially when editing an existing design. Avoid unrelated style adjectives and conflicting requirements.

For substantial prompt work, consult only the relevant reference:

- `subskills/openai/SKILL.md`: structured generation/edit prompts, layout, typography, and preservation constraints.
- `subskills/nanobanana/SKILL.md`: reference-image roles, character consistency, camera framing, and iterative edits.

These are prompting references, not alternative execution recipes. Use the native OpenCode tool rather than provider SDKs, standalone scripts, or a separate image plugin.

## Invoke the native tool

Supported inputs:

- `prompt`: the generation or editing instruction.
- `images`: up to eight local file paths or HTTP(S) URLs for editing/reference input. Local paths are relative to the session directory or absolute. Inputs must be PNG, JPEG, WebP, or GIF and no larger than 20 MiB each.
- `model`: only for a user-requested model or variant, resolved as above.
- `path`: optional output path, relative to the session directory or absolute. OpenCode uses the image's actual format for the extension; an existing target is overwritten. Choose a new path unless replacement is intended. Without `path`, the image goes to the session's temporary image directory.

Each call creates one image. For multiple requested images, use one call per image. An edit uses the same tool with `images`; there is no separate edit endpoint for the agent to call.

Generation runs in the background. The initial result is a job ID and output path stem, not a finished image. Wait for the automatic completion notice; do not poll, sleep, search for the file, or repeat the request while waiting. On success, use the actual saved path from the notice and read the image to review it. Report a failed job with its actionable error instead of automatically issuing another paid request.

## Review and continue

Check the requested composition, exact text, invariants, and any required output properties. Present the saved image or its actual path. Do not promise a workspace output folder or an immediate Markdown preview that the native tool does not provide.

For a follow-up edit, pass the previous saved image explicitly in `images` along with the new instruction. There is no plugin-specific continuity ID or automatic recent-image lookup. Keep unchanged details explicit, and generate another version only when the user requests it.
