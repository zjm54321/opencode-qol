import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { loadConfiguration } from "./config.js";
import { executeOpenAIImageGen } from "./openai.js";
import { executeNanoBananaImageGen } from "./nanobanana.js";
import { conversationImagePaths, imageFailure } from "./images.js";

export default Plugin.define({
  id: "opencode.qol.image",
  async setup(ctx) {
    loadConfiguration(undefined, ctx.location.directory);

    const registration = await ctx.tool.transform((editor) => {
      editor.add({
        name: "image_gen",
        options: { codemode: false },
        description: "Generate or edit images with configured OpenAI Image models (such as gpt-image-2.5-flare, gpt-image-2.5-sunburst). Saves workspace files and returns Markdown previews with generation metadata.",
        input: z.object({
          prompt: z.string().min(1).describe("Detailed description of the image to generate or edit."),
          model: z.string().optional().describe("Explicit model ID required (e.g. 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'). Use image_models to list available models."),
          transparent_background: z.boolean().optional().describe("Whether the output should have a transparent background (PNG). Defaults to false."),
          referenced_image_paths: z.array(z.string()).optional().describe("Local image file paths for editing/inpainting."),
          num_last_images_to_include: z.number().int().min(0).max(5).optional().describe("Number of recent conversation images to reference (0-5)."),
          aspect_ratio: z.string().optional().describe("Aspect ratio (e.g. '1:1', '16:9', '9:16', '4:3', '3:4', '21:9')."),
          quality: z.string().optional().describe("Image quality: 'low', 'medium', 'high', 'xhigh', 'max', or 'auto'."),
        }).strict(),
        async execute(input, execution) {
          const cwd = ctx.location?.directory || process.cwd();
          try {
            const config = loadConfiguration(undefined, cwd).openai;
            const recentImagePaths = input.num_last_images_to_include
              ? conversationImagePaths(await ctx.session.context({ sessionID: execution.sessionID })) : [];
            return await executeOpenAIImageGen(input, cwd, { config, recentImagePaths, signal: execution.signal });
          } catch (error) {
            return imageFailure(error, execution.signal);
          }
        },
      });

      editor.add({
        name: "image_gen_nano",
        options: { codemode: false },
        description: "Generate or edit images with Google Gemini / Nano Banana models (such as gemini-3.1-flash-image). Supports native aspect ratios and multi-image reference. Saves image locally and returns markdown link.",
        input: z.object({
          prompt: z.string().min(1).describe("Description of the image to generate or editing instruction."),
          model: z.string().optional().describe("Explicit model ID required (e.g. 'gemini-3.1-flash-image'). Use image_models to list available models."),
          aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "2:3", "3:2", "4:5", "5:4"]).optional().describe("Aspect ratio of the generated image. Defaults to '1:1'."),
          referenced_image_paths: z.array(z.string()).optional().describe("Local image file paths for character consistency or image-to-image."),
          session_id: z.string().optional().describe("Optional session ID for multi-turn character or world continuity."),
          resolution: z.enum(["0.5K", "1K", "2K", "4K"]).optional().describe("Resolution level. Defaults to '1K'."),
        }).strict(),
        async execute(input, execution) {
          const cwd = ctx.location?.directory || process.cwd();
          try {
            const config = loadConfiguration(undefined, cwd).nanobanana;
            // Scope user-supplied continuity IDs to the actual OpenCode conversation.
            const args = { ...input, session_id: input.session_id ? JSON.stringify([execution.sessionID, input.session_id]) : undefined };
            return await executeNanoBananaImageGen(args, cwd, { config, signal: execution.signal });
          } catch (error) {
            return imageFailure(error, execution.signal);
          }
        },
      });

      editor.add({
        name: "image_models",
        options: { codemode: false },
        description: "List available and configured image generation models, formatted like OpenCode models.",
        input: z.object({
          provider: z.enum(["all", "openai", "google"]).optional().default("all").describe("Filter by provider (all, openai, or google)."),
        }).strict(),
        async execute(input) {
          const cwd = ctx.location?.directory || process.cwd();
          const cfg = loadConfiguration(undefined, cwd);
          const lines: string[] = [];
          const models: Array<{ providerID: string; id: string }> = [];

          if (input.provider === "all" || input.provider === "openai") {
            const list = cfg.openai.whitelist?.length ? cfg.openai.whitelist : (cfg.openai.available_models ?? []);
            for (const m of list) {
              models.push({ providerID: "openai", id: m });
              lines.push(`openai/${m}`);
            }
          }
          if (input.provider === "all" || input.provider === "google") {
            const list = cfg.nanobanana.whitelist?.length ? cfg.nanobanana.whitelist : (cfg.nanobanana.available_models ?? []);
            for (const m of list) {
              models.push({ providerID: "google", id: m });
              lines.push(`google/${m}`);
            }
          }

          lines.sort((a, b) => a.localeCompare(b));
          return {
            content: lines.length ? lines.join("\n") : "No image models available.",
            metadata: { count: models.length, models },
          };
        },
      });
    });

    return () => registration.dispose();
  },
});
