import { packageChatContent, sanitizeAttachments } from "./pack.ts";
import { MAX_DATA_URL_CHARS, type ChatContent, type ImageAttachment } from "./types.ts";

/** Max prior-turn images re-sent to the model (current turn images are separate). */
export const MAX_HISTORY_IMAGES = 3;
/** Soft byte/char budget for prior-turn image data-URLs combined. */
export const MAX_HISTORY_IMAGE_CHARS = Math.floor(MAX_DATA_URL_CHARS * 1.5);

export type HistoryInputMessage = {
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
  options: { maxImages?: number; maxImageChars?: number } = {},
): { role: "user" | "assistant"; content: ChatContent }[] {
  const maxImages = options.maxImages ?? MAX_HISTORY_IMAGES;
  const maxChars = options.maxImageChars ?? MAX_HISTORY_IMAGE_CHARS;
  const sliced = history.slice(-12);

  // Decide which user-message indices keep images (scan from end).
  let imagesLeft = maxImages;
  let charsLeft = maxChars;
  const keep = new Set<number>();
  for (let i = sliced.length - 1; i >= 0; i--) {
    const msg = sliced[i]!;
    if (msg.role !== "user") continue;
    const imgs = sanitizeAttachments(msg.images ?? []);
    if (imgs.length === 0) continue;
    const cost = imgs.reduce((sum, img) => sum + img.dataUrl.length, 0);
    if (imgs.length > imagesLeft || cost > charsLeft) continue;
    keep.add(i);
    imagesLeft -= imgs.length;
    charsLeft -= cost;
  }

  return sliced.map((msg, index) => {
    if (msg.role === "assistant") return { role: "assistant" as const, content: msg.content };
    const imgs = keep.has(index) ? sanitizeAttachments(msg.images ?? []) : [];
    if (imgs.length === 0) {
      return { role: "user" as const, content: msg.content };
    }
    // Prefer original prompt text; content may already include an [Attached:] stub.
    const text = stripAttachedStub(msg.content) || msg.content;
    return { role: "user" as const, content: packageChatContent(text, imgs) };
  });
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
