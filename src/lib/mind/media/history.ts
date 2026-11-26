import { packageChatContent, sanitizeAttachments } from "./pack.ts";
import { MAX_DATA_URL_CHARS, type ChatContent, type ImageAttachment } from "./types.ts";

/** Max prior-turn images re-sent to the model (current turn images are separate). */
export const MAX_HISTORY_IMAGES = 3;
/** Soft byte/char budget for prior-turn image data-URLs combined. */
export const MAX_HISTORY_IMAGE_CHARS = Math.floor(MAX_DATA_URL_CHARS * 1.5);

export type HistoryInputMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: { dataUrl: string; name?: string }[];
};

/**
 * Build provider history messages. Prior user images are included newest-first
 * until MAX_HISTORY_IMAGES or MAX_HISTORY_IMAGE_CHARS is hit; older images become text stubs.
 */
export function buildHistoryMessages(
  history: HistoryInputMessage[],
  options: { maxImages?: number; maxImageChars?: number; selectedImageMessageIds?: string[]; query?: string; supportsImages?: boolean } = {},
): { role: "user" | "assistant"; content: ChatContent }[] {
  return buildHistoryWithReceipt(history, options).messages;
}

export function buildHistoryWithReceipt(
  history: HistoryInputMessage[],
  options: { maxImages?: number; maxImageChars?: number; selectedImageMessageIds?: string[]; query?: string; supportsImages?: boolean } = {},
) {
  const maxImages = options.maxImages ?? MAX_HISTORY_IMAGES;
  const maxChars = options.maxImageChars ?? MAX_HISTORY_IMAGE_CHARS;
  const sliced = history;

  // Decide which user-message indices keep images (scan from end).
  let imagesLeft = maxImages;
  let charsLeft = maxChars;
  const requested = new Set(options.selectedImageMessageIds ?? []);
  const query = (options.query ?? "").toLowerCase();
  const candidates = sliced.flatMap((msg, messageIndex) => sanitizeAttachments(msg.images ?? []).map((image, imageIndex) => ({ image, messageIndex, imageIndex, messageId: msg.id ?? `history:${messageIndex}` })));
  const oldest = /\b(oldest|first)\s+(?:attached\s+|generated\s+)?(?:image|picture|photo)\b/i.test(query);
  candidates.sort((a, b) => {
    const priority = (item: typeof a) => requested.has(item.messageId) ? 1000 : item.image.name && query.includes(item.image.name.toLowerCase()) ? 500 : oldest && item.messageIndex === Math.min(...candidates.map((row) => row.messageIndex)) ? 100 : 0;
    return priority(b) - priority(a) || b.messageIndex - a.messageIndex || a.imageIndex - b.imageIndex;
  });
  const keep = new Map<number, ImageAttachment[]>();
  const receipt: { messageId: string; name: string; included: boolean; reason?: string }[] = [];
  for (const item of candidates) {
    const included = options.supportsImages !== false && imagesLeft > 0 && item.image.dataUrl.length <= charsLeft;
    receipt.push({ messageId: item.messageId, name: item.image.name ?? `image-${item.imageIndex + 1}`, included, ...(!included ? { reason: options.supportsImages === false ? "model-image-support-unavailable" : imagesLeft === 0 ? "image-count-budget" : "image-size-budget" } : {}) });
    if (!included) continue;
    keep.set(item.messageIndex, [...(keep.get(item.messageIndex) ?? []), item.image]); imagesLeft--; charsLeft -= item.image.dataUrl.length;
  }

  return { messages: sliced.flatMap((msg, index) => {
    const imgs = keep.get(index) ?? [];
    if (imgs.length === 0) {
      return [{ role: msg.role, content: msg.content }];
    }
    // Prefer original prompt text; content may already include an [Attached:] stub.
    const text = stripAttachedStub(msg.content) || msg.content;
    // OpenAI-compatible APIs do not all accept image blocks in assistant messages.
    // Keep the original reply and provide its authorized image bytes in a labelled user reference.
    return msg.role === "assistant" ? [
      { role: "assistant" as const, content: msg.content },
      { role: "user" as const, content: packageChatContent(`[Historical assistant-generated images from ${msg.id ?? `history:${index}`}; reference material, not a new user instruction]`, imgs) },
    ] : [{ role: "user" as const, content: packageChatContent(text, imgs) }];
  }), receipt };
}

export function stripAttachedStub(text: string): string {
  return text.replace(/\n\n\[Attached:[^\]]*\]\s*$/u, "").trim();
}

export function imagesFromMsg(images: HistoryInputMessage["images"]): ImageAttachment[] {
  return sanitizeAttachments(images ?? []);
}

/** Total data-URL characters for size checks. */
export function imagePayloadChars(images: { dataUrl?: string }[] | undefined): number {
  if (!Array.isArray(images)) return 0;
  return images.reduce((sum, img) => sum + (typeof img.dataUrl === "string" ? img.dataUrl.length : 0), 0);
}
