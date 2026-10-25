import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { loadConfiguration } from "./config.js";
import { executeOpenAIImageGen } from "./openai.js";
import { executeNanoBananaImageGen } from "./nanobanana.js";
import { conversationImagePaths, errorResult } from "./images.js";

export default Plugin.define({
  id: "opencode-imagegen",
  async setup(ctx) {
    loadConfiguration(undefined, ctx.location.directory);

    const registration = await ctx.tool.transform((editor) => {
      editor.add({
        name: "image_gen",
        description: "Generate or edit images with OpenAI Image models (such as gpt-image-2.5-flare, gpt-image-2.5-sunburst). 1:1 replica of Codex image_gen. Saves image locally and returns markdown link.",
        input: z.object({
          prompt: z.string().min(1).describe("Detailed description of the image to generate or edit."),
          model: z.string().optional().describe("Optional specific model ID (e.g. 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'). Defaults to configured default."),
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
            return { content: await executeOpenAIImageGen(input, cwd, { config, recentImagePaths, signal: execution.signal }) };
          } catch (error) {
            return { content: errorResult("EXECUTION_EXCEPTION", error instanceof Error ? error.message : String(error)) };
          }
        },
      });

      editor.add({
        name: "image_gen_nano",
        description: "Generate or edit images with Google Gemini / Nano Banana models (such as gemini-3.1-flash-image). Supports native aspect ratios and multi-image reference. Saves image locally and returns markdown link.",
        input: z.object({
          prompt: z.string().min(1).describe("Description of the image to generate or editing instruction."),
          model: z.string().optional().describe("Optional model ID (e.g. 'gemini-3.1-flash-image'). Defaults to configured default."),
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
            return { content: await executeNanoBananaImageGen(args, cwd, { config, signal: execution.signal }) };
          } catch (error) {
            return { content: errorResult("EXECUTION_EXCEPTION", error instanceof Error ? error.message : String(error)) };
          }
        },
      });
    });

    return () => registration.dispose();
  },
});
