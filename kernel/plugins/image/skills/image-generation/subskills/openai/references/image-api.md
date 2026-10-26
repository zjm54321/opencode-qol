# Image API quick reference

Adapted from OpenAI's imagegen reference. These are underlying API details, not instructions to run an SDK or shell command. Call the direct built-in `image_gen` tool; its schema defines the supported arguments.

## Scope
- Historical GPT Image API controls below describe `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`; use configured presets for newer models.
- The built-in tool exposes only a subset of API controls.

## Endpoints
- Generate: `POST /v1/images/generations` (`client.images.generate(...)`)
- Edit: `POST /v1/images/edits` (`client.images.edit(...)`)

## Core parameters for GPT Image models
- `prompt`: text prompt
- `model`: image model
- `n`: number of images (1-10)
- `size`: `1024x1024`, `1536x1024`, `1024x1536`, or `auto`
- `quality`: `low`, `medium`, `high`, or `auto`
- `background`: output transparency behavior (`transparent`, `opaque`, or `auto`) for generated output; this is not the same thing as the prompt's visual scene/backdrop
- `output_format`: `png` (default), `jpeg`, `webp`
- `output_compression`: 0-100 (jpeg/webp only)
- `moderation`: `auto` (default) or `low`

## Edit-specific parameters
- `image`: one or more input images. For GPT Image models, you can provide up to 16 images.
- `mask`: optional mask image
- `input_fidelity`: `low` (default) or `high`

Model-specific note for `input_fidelity`:
- `gpt-image-1` and `gpt-image-1-mini` preserve all input images, but the first image gets richer textures and finer details.
- `gpt-image-1.5` preserves the first 5 input images with higher fidelity.

## Output
- `data[]` list with `b64_json` per image
- The built-in tool decodes `b64_json`, saves workspace files and returns Markdown links and count/file metadata.

## Limits and notes
- Input images and masks must be under 50MB.
- Use the edits endpoint when the user requests changes to an existing image.
- Masking is prompt-guided; exact shapes are not guaranteed.
- Large sizes and high quality increase latency and cost.
- High `input_fidelity` can materially increase input token usage.
- If a request fails because a specific option is unsupported by the selected GPT Image model, retry manually without that option.

## Important boundary
- The tool accepts `quality`, maps `aspect_ratio` to size, and maps `transparent_background` to API transparency controls.
- `n`, `input_fidelity`, explicit masks, raw `background`, `output_format` and output paths are not built-in tool arguments. Do not use a shell workaround.
