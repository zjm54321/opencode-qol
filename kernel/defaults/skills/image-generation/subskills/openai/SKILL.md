---
name: imagegen
description: "Prompting reference for image generation and precise edits through OpenCode's native image tool."
---

# Image Prompting and Edits

This is a prompting reference adapted from OpenAI's image skill. Follow the parent `image-generation` skill for model selection, native tool inputs, output paths, and background completion. Execution uses `experimental_image_generate`.

## Shape the request

Distinguish a new image, a reference-guided image, and an edit. For each input image, identify whether it is the edit target, a subject reference, a style reference, or a compositing element. Inspect local source images when their visible details matter, then pass their paths in `images`.

Preserve a detailed user prompt; add only structure and details that support the stated intent. For a broad request, choose a coherent composition, lighting, and visual treatment without inventing additional subjects, branding, or narrative requirements.

Useful prompt components, included only when relevant:

- **Deliverable:** intended use and medium, such as a product photograph, editorial illustration, texture, or mockup.
- **Subject and setting:** what must appear and the environment around it.
- **Composition:** framing, camera angle, hierarchy, and any negative space needed by the surrounding layout.
- **Appearance:** lighting, palette, materials, texture, and finish.
- **Text:** exact wording in quotation marks, with placement and typographic treatment.
- **Constraints:** what must remain unchanged and what must not appear.

For longer prompting guidance, read `references/prompting.md`; consult `references/sample-prompts.md` for use-case patterns. Treat their examples as prompting material, not provider setup or execution instructions.

## Edit precisely

Describe the requested change first and list invariants explicitly: preserve identity, pose, geometry, crop, layout, lighting, or existing text as appropriate. For a localized edit, name the region in ordinary visual terms. The native tool does not expose a mask argument, so do not promise pixel-exact masked edits.

Use the original image as an explicit reference instead of reconstructing it from a description. For another iteration, pass the selected previous result in `images` and describe only the new delta. A repeat generation is not guaranteed to reproduce the previous result.

## Output requirements

An exact canvas size, quality level, or alpha-channel requirement needs a compatible configured model/preset; these are not additional native tool arguments. Keep scene background descriptions separate from an actual transparent-output setting.

After the completion notice, review subject fidelity, composition, text accuracy, and preservation constraints. Use a new output path for a variation unless replacement was requested. A project asset should have an explicit workspace destination rather than remain only in the default temporary folder.
