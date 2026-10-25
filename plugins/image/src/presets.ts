export interface ModelPreset {
  id: string;
  provider: "openai" | "nanobanana";
  displayName: string;
  supportsTransparency: boolean;
  allowedAspectRatios: string[];
  maxEditImages: number;
  qualityOptions: string[];
  requires16Multiple?: boolean;
  supportsResolution?: boolean;
}

export const BUILTIN_MODEL_PRESETS: Record<string, ModelPreset> = {
  // OpenAI Family
  "gpt-image-2.5-flare": {
    id: "gpt-image-2.5-flare",
    provider: "openai",
    displayName: "OpenAI GPT Image 2.5 Flare",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9", "auto"],
    maxEditImages: 10,
    qualityOptions: ["low", "medium", "high", "xhigh", "max", "auto"],
    requires16Multiple: true,
  },
  "gpt-image-2.5-sunburst": {
    id: "gpt-image-2.5-sunburst",
    provider: "openai",
    displayName: "OpenAI GPT Image 2.5 Sunburst",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9", "auto"],
    maxEditImages: 10,
    qualityOptions: ["low", "medium", "high", "xhigh", "max", "auto"],
    requires16Multiple: true,
  },
  "image-2.5": {
    id: "gpt-image-2.5-flare",
    provider: "openai",
    displayName: "OpenAI Image 2.5 (Alias -> Flare)",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9", "auto"],
    maxEditImages: 10,
    qualityOptions: ["low", "medium", "high", "xhigh", "max", "auto"],
    requires16Multiple: true,
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    provider: "openai",
    displayName: "OpenAI GPT Image 2",
    supportsTransparency: false,
    allowedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "auto"],
    maxEditImages: 5,
    qualityOptions: ["low", "medium", "high", "auto"],
    requires16Multiple: true,
  },
  "gpt-image-1.5": {
    id: "gpt-image-1.5",
    provider: "openai",
    displayName: "OpenAI GPT Image 1.5",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "16:9", "9:16", "auto"],
    maxEditImages: 5,
    qualityOptions: ["low", "medium", "high", "auto"],
    requires16Multiple: false,
  },
  "gpt-image-1-mini": {
    id: "gpt-image-1-mini",
    provider: "openai",
    displayName: "OpenAI GPT Image 1 Mini",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "16:9", "9:16", "auto"],
    maxEditImages: 5,
    qualityOptions: ["low", "medium", "high", "auto"],
    requires16Multiple: false,
  },

  // Google Gemini / Nano Banana Family
  "gpt-image-1": {
    id: "gpt-image-1",
    provider: "openai",
    displayName: "OpenAI GPT Image 1",
    supportsTransparency: true,
    allowedAspectRatios: ["1:1", "16:9", "9:16", "auto"],
    maxEditImages: 5,
    qualityOptions: ["low", "medium", "high", "auto"],
    requires16Multiple: false,
  },
  "gemini-2.5-flash-image": {
    id: "gemini-2.5-flash-image",
    provider: "nanobanana",
    displayName: "Nano Banana (Gemini 2.5 Flash Image)",
    supportsTransparency: false,
    allowedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    maxEditImages: 3,
    qualityOptions: ["1K"],
    supportsResolution: false,
  },
  "gemini-3.1-flash-image": {
    id: "gemini-3.1-flash-image",
    provider: "nanobanana",
    displayName: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    supportsTransparency: false,
    allowedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    maxEditImages: 4,
    qualityOptions: ["0.5K", "1K", "2K", "4K"],
  },
  "gemini-3-pro-image": {
    id: "gemini-3-pro-image",
    provider: "nanobanana",
    displayName: "Nano Banana Pro (Gemini 3 Pro Image)",
    supportsTransparency: false,
    allowedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    maxEditImages: 5,
    qualityOptions: ["1K", "2K", "4K"],
  },
  "gemini-3.1-flash-lite-image": {
    id: "gemini-3.1-flash-lite-image",
    provider: "nanobanana",
    displayName: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite)",
    supportsTransparency: false,
    allowedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    maxEditImages: 2,
    qualityOptions: ["0.5K", "1K"],
  },
};

/**
 * Aspect Ratio to standard 16-multiple pixel dimensions for OpenAI models.
 */
export const ASPECT_RATIO_TO_PIXELS: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x864",
  "9:16": "864x1536",
  "4:3": "1280x960",
  "3:4": "960x1280",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "21:9": "1536x656",
  "4:5": "1024x1280",
  "5:4": "1280x1024",
  "auto": "auto",
};

/**
 * Ensures given dimensions are snapped to multiples of 16px and within bounds.
 */
export function snapTo16Pixels(width: number, height: number): { width: number; height: number } {
  let w = Math.round(width / 16) * 16;
  let h = Math.round(height / 16) * 16;
  w = Math.max(512, Math.min(3840, w));
  h = Math.max(512, Math.min(3840, h));
  return { width: w, height: h };
}
