import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const imageMimeTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

export function errorResult(error_code: string, message: string, details = {}): string {
  return JSON.stringify({ status: "error", error_code, message, ...details });
}

export async function readImage(imagePath: string, workspaceDir: string) {
  const inline = imagePath.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z\d+/=\s]+)$/);
  if (inline) return { bytes: Buffer.from(inline[2], "base64"), mimeType: inline[1], name: "conversation-image" };
  const absolute = path.resolve(workspaceDir, imagePath);
  const mimeType = imageMimeTypes[path.extname(absolute).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported reference image format: ${imagePath}`);
  return { bytes: await fs.readFile(absolute), mimeType, name: path.basename(absolute) };
}

export async function saveImage(workspaceDir: string, engine: "openai" | "nano", data: string, mime: string): Promise<string> {
  const ext = Object.entries(imageMimeTypes).find(([, type]) => type === mime)?.[0];
  if (!ext) throw new Error(`Unsupported output image MIME type: ${mime}`);
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) throw new Error("Empty image data");
  const relative = `.opencode/generated-images/${engine}/img-${crypto.randomUUID()}${ext}`;
  const absolute = path.resolve(workspaceDir, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);
  return relative;
}

export function preview(relative: string): string {
  return `![Generated image](${relative})\n\n\`${relative}\``;
}

/** Collect local attachments and image previews from the actual session context, not other sessions. */
export function conversationImagePaths(messages: unknown): string[] {
  const paths: string[] = [];
  function add(value: string) {
    if (/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
      if (!paths.includes(value)) paths.push(value);
      return;
    }
    if (value.startsWith("file:")) value = fileURLToPath(value);
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) return;
    if (imageMimeTypes[path.extname(value).toLowerCase()]) {
      const previous = paths.indexOf(value);
      if (previous >= 0) paths.splice(previous, 1);
      paths.push(value);
    }
  }
  function visit(value: unknown): void {
    if (typeof value === "string") {
      for (const match of value.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) add(match[1]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (String(record.mime ?? record.mimeType ?? "").startsWith("image/")) {
        if (typeof record.data === "string" && record.data) {
          add(record.data.startsWith("data:") ? record.data : `data:${record.mime ?? record.mimeType};base64,${record.data}`);
        } else {
          const source = record.source as { uri?: string } | undefined;
          const uri = record.uri ?? record.url ?? record.path ?? source?.uri;
          if (typeof uri === "string") add(uri);
        }
      }
      // Inputs contain references, not images returned to the conversation.
      for (const [key, child] of Object.entries(record)) if (key !== "input") visit(child);
    }
  }
  visit(messages);
  return paths;
}
