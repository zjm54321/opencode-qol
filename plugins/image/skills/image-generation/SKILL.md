---
name: image-generation
description: "Generate, edit, or transform images. Use when the task requires creating visual assets, illustrations, diagrams, textures, icons, mockups, or editing existing images."
---

# Image Generation Master Skill

This skill is the central router and orchestrator for image generation and visual editing in OpenCode. It evaluates task requirements, inspects available models in the current runtime, and routes execution to the appropriate image engine and its bundled subskill.

---

## 1. Universal Model Capabilities Matrix

This matrix documents the full spectrum of supported models across both the OpenAI (Codex upstream) and Google Gemini (Nano Banana upstream) ecosystems. This is a reference map of capabilities; actual model availability in the current environment is determined dynamically at runtime by `opencode.json`.

| Provider / Family | Model ID | Primary Strengths | Key Constraints & Considerations |
| :--- | :--- | :--- | :--- |
| **OpenAI** | `gpt-image-2.5-flare` | Fast everyday flagship, natural lighting, high texture fidelity, native `transparent` background support | Fine-grained localized micro-edits are better handled by Sunburst |
| | `gpt-image-2.5-sunburst` | Precision inpainting, high style adherence, complex multi-element editing (`edits`) | Higher latency; optimal for final deliverables and intricate edits |
| | `gpt-image-2` | Baseline 2.0 realism, strong spatial layout | Custom sizes must strictly be multiples of 16px; no native transparent background output |
| | `gpt-image-1.5` | Legacy transparent background generation, crisp graphic/vector styling | Lower detail fidelity compared to 2.5 series |
| | `gpt-image-1`, `gpt-image-1-mini` | Older generation and economical variants | Fixed 1024×1024, 1536×1024 or 1024×1536 canvases; landscape/portrait ratios are approximate |
| | `image-2.5` | Gateway alias for the 2.5 family | Only use if explicitly enabled by the gateway configuration |
| **Google Gemini** | `gemini-3.1-flash-image` | High throughput, excellent textual rendering (posters, signs, typography), native aspect ratio scaling | No native transparent Alpha channel (outputs solid background JPEG/PNG) |
| | `gemini-3-pro-image` | Complex multi-image fusion, deep multimodal prompt alignment, character consistency | Higher compute requirements; reserved for advanced multi-reference composition |
| | `gemini-3.1-flash-lite-image` | Ultra-fast previews (~4s), rapid compositional iteration | Reduced resolution and fine-grain details |
| | `gemini-2.5-flash-image` | Earlier Nano Banana image generation and editing | 1K output; no native alpha |

The matrix and bundled presets are routing hints, not a provider availability guarantee. For configured custom IDs, check the gateway's actual capabilities. Unknown IDs must be explicitly allowlisted.

---

## 2. Dynamic Model Discovery & Decision Workflow

The agent MUST follow this runtime workflow before initiating image generation:

Read project `opencode.json`, global `~/.config/opencode/opencode.json`, and the dedicated `~/.config/opencode/imagegen.json` (or `$XDG_CONFIG_HOME/opencode/`). Never print credential values. Explicit `image_generation.<engine>.available_models` determines the allowlist; `default_model` chooses the initial model. Provider blocks supply credentials and endpoints, not permission to invoke arbitrary model IDs. Explicit project settings override global and dedicated settings.

```
[User Task Request]
        │
        ▼
[Analyze Capability Requirements]
 (Transparency, aspect ratio, text rendering, inpainting, speed)
        │
        ▼
[Inspect Runtime Enabled Models] ──► (Read `opencode.json` or query tool configuration)
        │
   ┌────┴─────────────────────────────┐
   ▼                                  ▼
[Target Model is Available]     [Target Model Not Configured]
   │                                  │
   │                                  ▼
   │                            [Apply Fallback Ladder]
   │                            (Select closest available model)
   │                                  │
   └───────────────┬──────────────────┘
                   ▼
       [Route to Engine & Subskill]
       - OpenAI Engine (image_gen)       ──► read subskills/openai/SKILL.md
       - Gemini Engine (image_gen_nano) ──► read subskills/nanobanana/SKILL.md
```

### Decision Routing Rules

1. **Transparent Background / Cutout / Icon / Sticker:**
   - Preferred Route: **OpenAI** (`image_gen`) with `transparent_background: true`.
   - Optimal Model: `gpt-image-2.5-flare` (or `gpt-image-2.5-sunburst` / `gpt-image-1.5`).
   - Do NOT route transparent requests to Gemini (it does not output native Alpha channels).

2. **In-Image Typography, Signboards, Book Covers, Complex Lettering:**
   - Preferred Route: **Gemini / Nano Banana** (`image_gen_nano`).
   - Optimal Model: `gemini-3.1-flash-image` (or `gemini-3-pro-image` if available).

3. **Specific Aspect Ratios (16:9, 9:16, 4:5, 5:4, 21:9):**
   - Both engines support aspect ratios.
   - For Gemini: pass `aspect_ratio` directly to `image_gen_nano`.
   - For OpenAI: `image_gen` automatically maps aspect ratios to valid pixel boundaries (multiples of 16).

4. **Multi-Image Character / Persona Consistency:**
   - Preferred Route: **Gemini / Nano Banana** (`image_gen_nano`) with `referenced_image_paths` and `session_id`.

5. **Localized Image Editing:**
    - Preferred Route: **OpenAI** (`image_gen`) with `referenced_image_paths`.
    - Describe the region and invariant details in the prompt. This tool has no explicit mask parameter.

### Fallback ladder

- **General generation:** configured engine default → other enabled models of that family with the required capabilities → enabled model of the other family only if it preserves the user's requirements.
- **Native transparency:** enabled Flare → Sunburst → GPT Image 1.5 → GPT Image 1 / Mini. Stop if none supports alpha; do not silently replace alpha with an opaque Gemini image.
- **Typography / multi-reference:** enabled Flash Image → Pro Image → Lite Image or Gemini 2.5 if the reference count and requested resolution fit → compatible enabled OpenAI model.
- On `MODEL_NOT_CONFIGURED`, use the returned `runtime_available_models`, intersect it with the required capabilities, and retry with one valid model. Never repeatedly guess IDs or alter the allowlist automatically.
- On `AUTH_MISSING`, `PROVIDER_DISABLED`, invalid references or unsupported parameters, report the actionable issue. On rate limits or provider failures, a different enabled model is acceptable only when cost and requirements remain within the user's authorization.

---

## 3. Subskill Delegation

Once the routing decision and target model are determined:

1. **OpenAI Route:**
   - Consult `subskills/openai/SKILL.md` for prompt structuring, lighting, composition, and style presets.
   - Call the native tool `image_gen` with `prompt` and optional parameters (`model`, `transparent_background`, `referenced_image_paths`).

2. **Gemini / Nano Banana Route:**
   - Consult `subskills/nanobanana/SKILL.md` for multimodal reference alignment, camera angle directives, and character prompt rules.
    - Call the native tool `image_gen_nano` with `prompt`, `aspect_ratio`, and optional parameters (`model`, `referenced_image_paths`, `session_id`).

### Local integration takes precedence over upstream execution recipes

The subskills are complete, unmodified upstream snapshots (including every script, recipe, reference and license). Use them for prompting and model guidance. For this plugin, always call the two tools above: do not switch to upstream Python CLIs, the Interactions API, upstream output folders, or video generation. Nano uses Gemini native `:generateContent`, multimodal `parts`, and inline image outputs; OpenAI uses its separate Images API.

`num_last_images_to_include` selects 0–5 local images from the current OpenCode conversation, not the latest files from other sessions. `session_id` on Nano reuses the preceding generated image and thought signature in the same workspace/model/conversation; continuity is in memory and resets on plugin restart. Use explicit references to resume after restart. Legacy OpenAI canvas ratios may be approximate; newer presets use 16-pixel boundaries.

Images generated by both tools are automatically persisted to the project workspace under `.opencode/generated-images/` and returned as lightweight Markdown links.
