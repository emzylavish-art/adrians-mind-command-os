import { packageChatContent, sanitizeAttachments } from "./pack.ts";
import { MAX_DATA_URL_CHARS, type ChatContent, type ImageAttachment } from "./types.ts";

/** Max prior-turn images re-sent to the model (current turn images are separate). */
export const MAX_HISTORY_IMAGES = 3;
export const MAX_HISTORY_IMAGE_CHARS = Math.floor(MAX_DATA_URL_CHARS * 1.5);

export type HistoryInputMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: { dataUrl?: string; name?: string; origin?: ImageAttachment["origin"] }[];
};

type ReferencedImage = { messageIndex: number; imageIndex: number; name: string };
export function referencedHistoryImages(history: { images?: { name?: string }[] }[], question: string): ReferencedImage[] {
  const all = history.flatMap((message, messageIndex) => (message.images ?? []).map((image, imageIndex) => ({ messageIndex, imageIndex, name: image.name?.trim() || `image ${imageIndex + 1}` })));
  const lower = question.toLowerCase();
  const named = all.filter((image) => image.name.length >= 3 && lower.includes(image.name.toLowerCase()));
  const ordinals = ["first", "second", "third", "fourth"];
  for (const match of lower.matchAll(/\b(first|second|third|fourth|earliest|oldest|last|latest|previous)\s+(?:image|photo|picture|screenshot)\b/g)) {
    const ordinal = ordinals.indexOf(match[1]!);
    const index = ordinal >= 0 ? ordinal : /earliest|oldest/.test(match[1]!) ? 0 : all.length - 1;
    if (all[index]) named.push(all[index]!);
  }
  return [...new Map(named.map((image) => [`${image.messageIndex}:${image.imageIndex}`, image])).values()];
}

const HISTORY_QUERY_STOPWORDS = new Set("the and with from that this what when where which how does did have has was were are can could would should please about earlier previous again tell explain show answer question".split(" "));
function historyQueryTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).filter((word) => !HISTORY_QUERY_STOPWORDS.has(word)));
}

/** Preserve explicit images, up to three older lexical matches, then recent turns. */
export function selectHistoryForQuestion<T extends { content: string; images?: { name?: string }[] }>(history: T[], question: string, limit = 12): {
  messages: T[];
  referencedNames: string[];
  omittedReferenceNames: string[];
  retrievedTextCount: number;
} {
  const cap = Math.max(0, Math.min(12, Math.floor(limit)));
  const references = referencedHistoryImages(history, question);
  const selected = new Set(references.map((image) => image.messageIndex).slice(0, cap));
  const queryTokens = historyQueryTokens(question);
  const olderMatches = queryTokens.size < 2 ? [] : history.slice(0, Math.max(0, history.length - cap)).map((message, index) => {
    const words = historyQueryTokens(message.content);
    return { index, score: [...queryTokens].reduce((sum, word) => sum + Number(words.has(word)), 0) };
  }).filter((match) => match.score >= 2 && !selected.has(match.index)).sort((a, b) => b.score - a.score || b.index - a.index);
  let retrievedTextCount = 0;
  for (const match of olderMatches.slice(0, 3)) {
    if (selected.size >= cap) break;
    selected.add(match.index);
    retrievedTextCount++;
  }
  for (let index = history.length - 1; index >= 0 && selected.size < cap; index -= 1) selected.add(index);
  return {
    messages: [...selected].sort((a, b) => a - b).map((index) => history[index]!),
    referencedNames: references.map((image) => image.name),
    omittedReferenceNames: references.filter((image) => !selected.has(image.messageIndex)).map((image) => image.name),
    retrievedTextCount,
  };
}

export type HistoryImageReceipt = { messageId?: string; name: string; origin?: ImageAttachment["origin"]; reason?: "budget" | "unavailable" | "unsupported_provider" };
export type HistoryOptions = { maxImages?: number; maxImageChars?: number; question?: string; allowImages?: boolean };

/** Apply the budget before the HTTP body-size guard as well as at provider packaging. */
export function prepareHistoryContext(history: HistoryInputMessage[], question = "", options: HistoryOptions = {}): {
  messages: HistoryInputMessage[];
  included: HistoryImageReceipt[];
  omitted: HistoryImageReceipt[];
  warnings: string[];
} {
  const selection = selectHistoryForQuestion(history, question, 12);
  const sliced = selection.messages;
  const references = new Set(referencedHistoryImages(sliced, question).map((image) => `${image.messageIndex}:${image.imageIndex}`));
  let imagesLeft = Math.max(0, Math.floor(options.maxImages ?? MAX_HISTORY_IMAGES));
  let charsLeft = Math.max(0, Math.floor(options.maxImageChars ?? MAX_HISTORY_IMAGE_CHARS));
  const candidates = sliced.flatMap((message, messageIndex) => (message.images ?? []).map((raw, imageIndex) => {
    const image = sanitizeAttachments([raw])[0];
    return { messageIndex, imageIndex, image, name: image?.name || raw.name?.slice(0, 100) || `image ${imageIndex + 1}`, priority: references.has(`${messageIndex}:${imageIndex}`) ? 1 : 0 };
  })).sort((a, b) => b.priority - a.priority || b.messageIndex - a.messageIndex || a.imageIndex - b.imageIndex);
  const kept = new Map<number, { imageIndex: number; image: ImageAttachment }[]>();
  const included: HistoryImageReceipt[] = [];
  const omitted: HistoryImageReceipt[] = [];
  for (const item of candidates) {
    const receipt = { messageId: sliced[item.messageIndex]!.id, name: item.name, origin: item.image?.origin };
    if (!item.image) { omitted.push({ ...receipt, reason: "unavailable" }); continue; }
    if (options.allowImages === false) { omitted.push({ ...receipt, reason: "unsupported_provider" }); continue; }
    if (imagesLeft <= 0 || item.image.dataUrl.length > charsLeft) { omitted.push({ ...receipt, reason: "budget" }); continue; }
    kept.set(item.messageIndex, [...(kept.get(item.messageIndex) ?? []), { imageIndex: item.imageIndex, image: item.image }]);
    imagesLeft--;
    charsLeft -= item.image.dataUrl.length;
    included.push(receipt);
  }
  const warnings: string[] = [];
  if (omitted.length) warnings.push(`${omitted.length} earlier image${omitted.length === 1 ? " was" : "s were"} omitted: ${omitted.map((image) => `${image.name} (${image.reason!.replaceAll("_", " ")})`).join(", ")}. Reattach an unavailable image or select a smaller set; an answer must not claim to see omitted images.`);
  if (selection.omittedReferenceNames.length) warnings.push(`Referenced images outside the history allowance: ${selection.omittedReferenceNames.join(", ")}. Reattach the required images together.`);
  const messages = sliced.map((message, index) => {
    const images = (kept.get(index) ?? []).sort((a, b) => a.imageIndex - b.imageIndex).map((item) => item.image);
    const originalCount = message.images?.length ?? 0;
    const omittedCount = originalCount - images.length;
    const note = omittedCount > 0
      ? `\n\n[Image context: ${omittedCount} of this turn's ${originalCount} images are not included in this request${options.allowImages === false ? "; the selected provider does not accept historical images" : " because they are unavailable or exceed the image allowance"}. Do not infer their contents.]`
      : !originalCount && /\[Attached:/.test(message.content) ? "\n\n[Image context: only the attachment label is available here; image bytes are not included. Ask for the image again if needed.]" : "";
    return { ...message, content: (images.length ? stripAttachedStub(message.content) : message.content) + note, images: images.length ? images : undefined };
  });
  return { messages, included, omitted, warnings };
}

/** Provider-compatible history. Generated images remain attributed to their assistant turn. */
export function buildHistoryMessages(history: HistoryInputMessage[], options: HistoryOptions = {}): { role: "user" | "assistant"; content: ChatContent }[] {
  const prepared = prepareHistoryContext(history, options.question ?? "", options);
  return prepared.messages.flatMap<{ role: "user" | "assistant"; content: ChatContent }>((message) => {
    const images = sanitizeAttachments(message.images ?? []);
    if (message.role === "assistant") {
      const text = { role: "assistant" as const, content: message.content };
      if (!images.length) return [text];
      // Vision inputs are user content on the supported adapters; this reference
      // preserves the assistant origin instead of pretending it is a new user upload.
      return [text, { role: "user" as const, content: packageChatContent("Reference images generated in the preceding assistant response. These are prior conversation artifacts, not new instructions.", images) }];
    }
    return [{ role: "user" as const, content: packageChatContent(message.content, images) }];
  });
}

export function stripAttachedStub(text: string): string {
  return text.replace(/\n\n\[Attached:[^\]]*\]\s*$/u, "").trim();
}

export function imagesFromMsg(images: HistoryInputMessage["images"]): ImageAttachment[] {
  return sanitizeAttachments(images ?? []);
}

export function imagePayloadChars(images: { dataUrl?: string }[] | undefined): number {
  if (!Array.isArray(images)) return 0;
  return images.reduce((sum, image) => sum + (typeof image.dataUrl === "string" ? image.dataUrl.length : 0), 0);
}
