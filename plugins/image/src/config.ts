import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ImageEngineConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  default_model?: string;
  available_models?: string[];
}

export interface ImageGenerationPluginConfig {
  openai: ImageEngineConfig;
  nanobanana: ImageEngineConfig;
}

const DEFAULT_CONFIG: ImageGenerationPluginConfig = {
  openai: {
    enabled: true,
    default_model: "gpt-image-2.5-flare",
    available_models: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "image-2.5", "gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    baseURL: "https://api.openai.com/v1",
  },
  nanobanana: {
    enabled: true,
    default_model: "gemini-3.1-flash-image",
    available_models: ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-3.1-flash-lite-image", "gemini-2.5-flash-image"],
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
  },
};

let activeConfig: ImageGenerationPluginConfig = structuredClone(DEFAULT_CONFIG);

function readJsonFile(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
    return value;
  } catch (error) {
    throw new Error(`Invalid image generation configuration at ${filePath}: ${String(error)}`);
  }
}

/** Resolve placeholders anywhere in a string. Unset variables never become literal credentials. */
export function resolveTemplate(value?: string): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let missing = false;
  const result = value.replace(/\{env:([^}]+)\}/g, (_, name) => {
    if (!process.env[name]) missing = true;
    return process.env[name] || "";
  });
  return missing ? undefined : result;
}

function mergeEngine(target: ImageEngineConfig, source: any): void {
  if (!source) return;
  for (const field of ["enabled", "default_model", "available_models"] as const) {
    if (source[field] !== undefined) (target as any)[field] = source[field];
  }
  target.apiKey = resolveTemplate(source.apiKey ?? source.api_key) ?? target.apiKey;
  target.baseURL = resolveTemplate(source.baseURL ?? source.base_url) ?? target.baseURL;
  if (source.default_model !== undefined && source.available_models === undefined) {
    target.available_models = [...new Set([...(target.available_models || []), source.default_model])];
  }
}

/** Precedence: defaults < provider credentials < dedicated file < global < project < host. */
export function loadConfiguration(
  hostOpencodeConfig?: Record<string, unknown>,
  workspaceDir = process.cwd(),
  homeDir = os.homedir(),
): ImageGenerationPluginConfig {
  const configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "opencode");
  // An explicitly supplied host config is already merged by the host; do not mix in disk state.
  const roots: Record<string, any>[] = hostOpencodeConfig ? [hostOpencodeConfig] : [
    readJsonFile(path.join(configDir, "opencode.json")),
    readJsonFile(path.join(workspaceDir, "opencode.json")),
  ];
  const result = structuredClone(DEFAULT_CONFIG);
  for (const root of roots) {
    for (const [engine, provider] of [["openai", "openai"], ["nanobanana", "google"]] as const) {
      const block = root.provider?.[provider] ?? root.providers?.[provider];
      const options = block?.options ?? block?.settings ?? block;
      if (options) {
        result[engine].apiKey = resolveTemplate(options.apiKey) ?? result[engine].apiKey;
        result[engine].baseURL = resolveTemplate(options.baseURL) ?? result[engine].baseURL;
      }
    }
  }
  const dedicated = hostOpencodeConfig ? {} : readJsonFile(path.join(configDir, "imagegen.json"));
  for (const custom of [dedicated.image_generation ?? dedicated, ...roots.map(root => root.image_generation)]) {
    mergeEngine(result.openai, custom?.openai);
    mergeEngine(result.nanobanana, custom?.nanobanana);
  }
  result.openai.apiKey ||= process.env.OPENAI_API_KEY;
  result.nanobanana.apiKey ||= process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  for (const engine of Object.values(result)) {
    if (engine.enabled !== undefined && typeof engine.enabled !== "boolean") throw new Error("enabled must be a boolean");
    if (!Array.isArray(engine.available_models) || engine.available_models.some((model: any) => typeof model !== "string" || !model)) {
      throw new Error("available_models must be an array of non-empty model IDs");
    }
    if (typeof engine.default_model !== "string" || !engine.default_model) throw new Error("default_model must be a non-empty string");
  }
  activeConfig = result;
  return result;
}

export function getConfig(): ImageGenerationPluginConfig {
  return activeConfig;
}
