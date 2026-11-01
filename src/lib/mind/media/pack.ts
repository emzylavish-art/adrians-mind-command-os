import { isImageDataUrl, normalizeImageDataUrl, parseImageDataUrl } from "./data-url.ts";
import { sanitizeMediaLabel } from "./harden.ts";
import type { ChatContent, ImageAttachment, MultimodalContentPart } from "./types.ts";
import { MAX_IMAGES_PER_TURN } from "./types.ts";

export function sanitizeAttachments(input: unknown): ImageAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ImageAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as { dataUrl?: unknown; name?: unknown; mime?: unknown };
    if (typeof record.dataUrl !== "string") continue;
    const normalized = normalizeImageDataUrl(record.dataUrl);
    if (!normalized) continue;
    const parsed = parseImageDataUrl(normalized);
    out.push({
      dataUrl: normalized,
      name: sanitizeMediaLabel(record.name),
      mime: parsed.ok ? parsed.mime : typeof record.mime === "string" ? record.mime : undefined,
    });
    if (out.length >= MAX_IMAGES_PER_TURN) break;
  }
  return out;
}

/** Build OpenAI-compatible multimodal content parts from text + image attachments. */
export function packageMultimodalContent(text: string, images: ImageAttachment[] = []): MultimodalContentPart[] {
  const parts: MultimodalContentPart[] = [];
  const trimmed = text.trim();
  if (trimmed) parts.push({ type: "text", text: trimmed });
  for (const image of images) {
    if (!isImageDataUrl(image.dataUrl)) continue;
    parts.push({
      type: "image_url",
      image_url: { url: image.dataUrl, detail: "auto" },
    });
  }
  if (parts.length === 0) parts.push({ type: "text", text: "Describe the attached image." });
  return parts;
}

/** Prefer a string when there are no images; otherwise return content parts. */
export function packageChatContent(text: string, images: ImageAttachment[] = []): ChatContent {
  const safe = sanitizeAttachments(images);
  if (safe.length === 0) return text;
  return packageMultimodalContent(text || "Describe the attached image.", safe);
}

export function contentHasImages(content: ChatContent): boolean {
  return Array.isArray(content) && content.some((part) => part.type === "image_url");
}

/** Text stub for history when an image was sent (avoids re-shipping megabytes). */
export function historyTextForImages(text: string, images: ImageAttachment[]): string {
  if (images.length === 0) return text;
  const labels = images.map((image, index) => image.name || `image-${index + 1}`).join(", ");
  const base = text.trim() || "Attached image.";
  return `${base}\n\n[Attached: ${labels}]`;
}

/** Runtime attachments for model turns: only hydrated data-URLs. */
export function toImageAttachments(images: { dataUrl?: string; name?: string; mime?: string }[] | undefined): ImageAttachment[] {
  return sanitizeAttachments(images ?? []);
}

