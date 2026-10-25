import { getConfig, type ImageEngineConfig } from "./config.js";
import { BUILTIN_MODEL_PRESETS, ASPECT_RATIO_TO_PIXELS } from "./presets.js";
import { errorResult, readImage, saveImage, preview } from "./images.js";

export interface ImageGenArgs {
  prompt: string;
  model?: string;
  transparent_background?: boolean;
  referenced_image_paths?: string[];
  num_last_images_to_include?: number;
  aspect_ratio?: string;
  quality?: string;
}

export async function executeOpenAIImageGen(
  args: ImageGenArgs,
  workspaceDir: string = process.cwd(),
  options: { config?: ImageEngineConfig; recentImagePaths?: string[]; signal?: AbortSignal } = {},
): Promise<string> {
  const config = options.config ?? getConfig().openai;
  if (config.enabled === false) return errorResult("PROVIDER_DISABLED", "OpenAI image generation is disabled.");
  const model = args.model || config.default_model || "gpt-image-2.5-flare";
  if (!config.available_models?.includes(model)) {
    return errorResult("MODEL_NOT_CONFIGURED", `Model '${model}' is not enabled.`, {
      requested_model: model, runtime_available_models: config.available_models ?? [],
    });
  }
  if (!config.apiKey) return errorResult("AUTH_MISSING", "Configure image_generation.openai or provider.openai credentials, or OPENAI_API_KEY.");
  const preset = BUILTIN_MODEL_PRESETS[model];
  const invalid = (message: string) => errorResult("INVALID_ARGUMENT", message);
  if (!args.prompt?.trim()) return invalid("prompt must not be empty.");
  if (preset && preset.provider !== "openai") return invalid("Use image_gen_nano for Google models.");
  if (args.aspect_ratio && (!ASPECT_RATIO_TO_PIXELS[args.aspect_ratio] || (preset && !preset.allowedAspectRatios.includes(args.aspect_ratio)))) {
    return invalid(`Unsupported aspect_ratio for ${model}: ${args.aspect_ratio}`);
  }
  if (args.quality && preset && !preset.qualityOptions.includes(args.quality)) return invalid(`Unsupported quality for ${model}: ${args.quality}`);
  if (args.transparent_background && preset?.supportsTransparency === false) return invalid(`${model} does not support transparent backgrounds.`);
  const count = args.num_last_images_to_include ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > 5) return invalid("num_last_images_to_include must be an integer from 0 to 5.");
  if (count > (options.recentImagePaths?.length ?? 0)) return invalid("Not enough local images in the current conversation; provide referenced_image_paths instead.");
  const references = [...new Set([...(args.referenced_image_paths || []), ...(count ? options.recentImagePaths!.slice(-count) : [])])];
  if (preset && references.length > preset.maxEditImages) return invalid(`${model} supports at most ${preset.maxEditImages} reference images.`);
  const baseURL = (config.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
  let size = ASPECT_RATIO_TO_PIXELS[args.aspect_ratio || "1:1"];
  // Older GPT Image APIs accept only their three fixed canvas sizes (or auto).
  if (preset?.requires16Multiple === false && args.aspect_ratio && args.aspect_ratio !== "auto") {
    size = args.aspect_ratio === "1:1" ? "1024x1024" : args.aspect_ratio === "16:9" ? "1536x1024" : "1024x1536";
  }
  const fields = {
    model, prompt: args.prompt, size, quality: args.quality || "auto",
    ...(args.transparent_background ? { background: "transparent", output_format: "png" } : {}),
  };
  try {
    let body: string | FormData;
    const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };
    if (references.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      for (const reference of references) {
        const { bytes, mimeType, name } = await readImage(reference, workspaceDir);
        form.append("image[]", new Blob([bytes], { type: mimeType }), name);
      }
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(fields);
    }
    const response = await fetch(`${baseURL}/images/${references.length ? "edits" : "generations"}`, {
      method: "POST", headers, body, signal: options.signal,
    });
    if (!response.ok) return errorResult(`HTTP_${response.status}`, `OpenAI Image API error: ${await response.text()}`);
    const data: any = await response.json();
    if (!data.data?.[0]?.b64_json) return errorResult("EMPTY_RESULT", "No image data returned from OpenAI Image API.");
    const relative = await saveImage(workspaceDir, "openai", data.data[0].b64_json, "image/png");
    return preview(relative);
  } catch (error) {
    return errorResult("EXECUTION_EXCEPTION", error instanceof Error ? error.message : String(error));
  }
}
