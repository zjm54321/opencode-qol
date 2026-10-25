import path from "node:path";
import { getConfig, type ImageEngineConfig } from "./config.js";
import { BUILTIN_MODEL_PRESETS } from "./presets.js";
import { errorResult, readImage, saveImage, preview, imageMimeTypes } from "./images.js";

export interface ImageGenNanoArgs {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  referenced_image_paths?: string[];
  session_id?: string;
  resolution?: string;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string }; thoughtSignature?: string };
type Turn = { role: "user" | "model"; parts: Part[] };
// Store paths, not base64 blobs; histories are isolated by workspace, endpoint, model and session.
const sessions = new Map<string, { prompt: string; image: string; signature?: string }>();

export async function executeNanoBananaImageGen(
  args: ImageGenNanoArgs,
  workspaceDir: string = process.cwd(),
  options: { config?: ImageEngineConfig; signal?: AbortSignal } = {},
): Promise<string> {
  const config = options.config ?? getConfig().nanobanana;
  if (config.enabled === false) return errorResult("PROVIDER_DISABLED", "Nano Banana image generation is disabled.");
  const model = args.model || config.default_model || "gemini-3.1-flash-image";
  if (!config.available_models?.includes(model)) {
    return errorResult("MODEL_NOT_CONFIGURED", `Model '${model}' is not enabled.`, {
      requested_model: model, runtime_available_models: config.available_models ?? [],
    });
  }
  if (!config.apiKey) return errorResult("AUTH_MISSING", "Configure image_generation.nanobanana or provider.google credentials.");
  const preset = BUILTIN_MODEL_PRESETS[model];
  const invalid = (message: string) => errorResult("INVALID_ARGUMENT", message);
  if (!args.prompt?.trim()) return invalid("prompt must not be empty.");
  if (preset && preset.provider !== "nanobanana") return invalid("Use image_gen for OpenAI models.");
  const aspectRatio = args.aspect_ratio || "1:1";
  const resolution = args.resolution || "1K";
  if (preset && !preset.allowedAspectRatios.includes(aspectRatio)) return invalid(`Unsupported aspect_ratio for ${model}: ${aspectRatio}`);
  if (preset && !preset.qualityOptions.includes(resolution)) return invalid(`Unsupported resolution for ${model}: ${resolution}`);
  if (preset && (args.referenced_image_paths?.length || 0) > preset.maxEditImages) return invalid(`${model} supports at most ${preset.maxEditImages} reference images.`);
  const baseURL = (config.baseURL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const modelID = encodeURIComponent(model.replace(/^models\//, ""));
  const url = `${baseURL}${baseURL.endsWith("/models") ? "" : "/models"}/${modelID}:generateContent`;
  const key = JSON.stringify([path.resolve(workspaceDir), baseURL, model, args.session_id]);
  try {
    const contents: Turn[] = [];
    const previous = args.session_id ? sessions.get(key) : undefined;
    if (previous) {
      const image = await readImage(previous.image, workspaceDir);
      contents.push({ role: "user", parts: [{ text: previous.prompt }] });
      contents.push({ role: "model", parts: [{
        inlineData: { mimeType: image.mimeType, data: image.bytes.toString("base64") },
        ...(previous.signature ? { thoughtSignature: previous.signature } : {}),
      }] });
    }
    const parts: Part[] = [];
    for (const reference of args.referenced_image_paths || []) {
      const image = await readImage(reference, workspaceDir);
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString("base64") } });
    }
    parts.push({ text: args.prompt });
    contents.push({ role: "user", parts });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
            ...(preset?.supportsResolution === false ? {} : { imageSize: resolution === "0.5K" ? "512" : resolution }),
          },
        },
      }),
      signal: options.signal,
    });
    if (!response.ok) return errorResult(`HTTP_${response.status}`, `Gemini Nano Banana API error: ${await response.text()}`);
    const data: any = await response.json();
    const outputParts: any[] = data.candidates?.[0]?.content?.parts || [];
    const imagePart = [...outputParts].reverse().find(part => !part.thought && part.inlineData?.data && Object.values(imageMimeTypes).includes(part.inlineData.mimeType));
    if (!imagePart) return errorResult("EMPTY_RESULT", "No inline image data found in Gemini response parts.");
    const relative = await saveImage(workspaceDir, "nano", imagePart.inlineData.data, imagePart.inlineData.mimeType);
    if (args.session_id) {
      sessions.delete(key);
      sessions.set(key, { prompt: args.prompt, image: relative, signature: imagePart.thoughtSignature });
      if (sessions.size > 100) sessions.delete(sessions.keys().next().value!);
    }
    return preview(relative);
  } catch (error) {
    return errorResult("EXECUTION_EXCEPTION", error instanceof Error ? error.message : String(error));
  }
}
