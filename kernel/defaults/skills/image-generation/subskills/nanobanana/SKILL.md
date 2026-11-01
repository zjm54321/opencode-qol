---
name: generate
description: "Reference-image and visual-consistency prompting guidance for OpenCode's native image generation."
---

# Reference-Guided Image Prompting

This reference adapts the image-prompting guidance from the Nano Banana skill. Follow the parent `image-generation` skill for execution with `experimental_image_generate`; use configured image models rather than standalone API recipes.

## Assign reference roles

Use real reference images when the request depends on a particular face, product, logo, or established visual identity. Identify the role of each source: subject identity, pose, composition, style, palette, or an element to insert. Select relevant images instead of passing an entire folder. OpenCode accepts at most eight inputs, and the selected model may impose a lower limit.

If an essential reference is missing, ask for it. For a new fictional subject without an existing reference, a description is sufficient. Do not claim that a textual approximation matches a real identity or exact brand mark.

## Build visual consistency

- State stable attributes explicitly: silhouette, distinctive features, clothing, palette, materials, lighting, and rendering style.
- Separate stable identity from the changing scene, pose, camera angle, or requested edit.
- For a series, use the user's approved image as a reference for later images. Passing the approved pixels anchors the result more directly than repeating adjectives.
- If the user supplies a style description, carry forward its essential constraints without adding competing styles.
- For text-heavy compositions, quote the exact wording and describe hierarchy, spacing, placement, and reading order.

## Iterate by delta

For “the same image, but change this,” pass the prior saved image in `images` and state both the change and what must stay fixed. Keep model/preset choices stable unless the user requests a change. Do not promise deterministic reruns or hidden conversation continuity; native follow-up edits use explicit image references.

A chosen draft does not automatically carry into a higher-quality result. If the user asks for a refinement, include that draft as a reference along with its composition and preservation constraints.

## Native output controls

Exact aspect ratio or resolution belongs in the configured model settings/variants, not extra tool inputs. Google image providers can use `settings.imageConfig.aspectRatio` and `settings.imageConfig.imageSize`; verify the selected model supports the required setting. Do not route a required alpha-channel deliverable to a model that cannot produce it.

Wait for the native job's completion notice before reviewing the saved image. Check identity, scene changes, typography, and consistency against the references. Report the actual output path and use that image explicitly for any user-requested follow-up.
