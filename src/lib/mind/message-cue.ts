import { sanitizeAttachments } from "./media/pack.ts";
import { MAX_IMAGES_PER_TURN, type ImageAttachment } from "./media/types.ts";

export type CuedFile = {
  name: string;
  text: string;
  source?: { fileId: string; revision: string; name: string };
};

export type CueAttachments = { file?: CuedFile; images: ImageAttachment[] };

export type CuedMessage = {
  id: string;
  text: string;
  paused?: boolean;
  claimed?: boolean;
  attachments?: CueAttachments;
  attachmentsUnavailable?: boolean;
};

export type CueResult<T extends CuedMessage = CuedMessage> = {
  queue: T[];
  error?: string;
};

export const CUE_LIMIT = 8;
export const CUE_TEXT_LIMIT = 8_000;
export const EMPTY_CUE: CuedMessage[] = [];

export function hasCueAttachments(attachments?: CueAttachments): boolean {
  return Boolean(attachments?.file || attachments?.images.length);
}

function readAttachments(input: unknown): CueAttachments | undefined {
  if (!input || typeof input !== "object") return;
  const { file, images } = input as CueAttachments;
  if (!Array.isArray(images) || images.length > MAX_IMAGES_PER_TURN) return;
  const safeImages = sanitizeAttachments(images);
  if (safeImages.length !== images.length) return;
  if (file !== undefined) {
    if (!file || typeof file.name !== "string" || !file.name.trim() || typeof file.text !== "string") return;
    const source = file.source;
    if (source !== undefined && (!source || typeof source.fileId !== "string" || typeof source.revision !== "string" || typeof source.name !== "string")) return;
    const safeFile: CuedFile = { name: file.name, text: file.text };
    if (source) safeFile.source = { fileId: source.fileId, revision: source.revision, name: source.name };
    return { file: safeFile, images: safeImages };
  }
  if (safeImages.length) return { images: safeImages };
}

export function cueMessage(queue: CuedMessage[], text: string, id: string): CueResult;
export function cueMessage<T extends CuedMessage>(queue: T[], item: T): CueResult<T>;
export function cueMessage(queue: CuedMessage[], item: CuedMessage | string, id?: string): CueResult {
  const message = typeof item === "string" ? { text: item, id: id! } : item;
  const trimmed = message.text.trim();
  const attachments = readAttachments(message.attachments);
  if (message.attachments && !attachments) return { queue, error: "Review the attachments before adding this draft to the queue." };
  if (!trimmed && !attachments) return { queue, error: "Write the message or attach a file before adding it to the queue." };
  if (trimmed.length > CUE_TEXT_LIMIT) return { queue, error: "Shorten the message to 8,000 characters or fewer." };
  if (queue.length >= CUE_LIMIT) return { queue, error: "The queue holds 8 messages. Remove one before adding another." };
  return { queue: [...queue, { ...message, text: trimmed, ...(attachments ? { attachments, paused: true } : {}) }] };
}

export function dropCued<T extends CuedMessage>(queue: T[], id: string): T[] {
  return queue.filter((item) => item.id !== id);
}

export function takeNextCue<T extends CuedMessage>(queue: T[], eligible: (item: T) => boolean = () => true): { next: T | null; queue: T[] } {
  const next = queue.find(eligible);
  return next ? { next, queue: dropCued(queue, next.id) } : { next: null, queue };
}

export function restoreCue<T extends CuedMessage>(queue: T[], held: T): T[] {
  if (queue.some((item) => item.id === held.id)) return queue;
  return [held, ...queue];
}

export function readCue(value: unknown): CuedMessage[] {
  if (!Array.isArray(value)) return EMPTY_CUE;
  const rows: CuedMessage[] = [];
  for (const item of value.slice(0, CUE_LIMIT)) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 80 ||
        typeof item.text !== "string" || item.text.length > CUE_TEXT_LIMIT ||
        rows.some(row => row.id === item.id)) continue;
    const attachments = readAttachments(item.attachments);
    const attachmentsUnavailable = item.attachmentsUnavailable === true || (item.attachments !== undefined && !attachments);
    if (!item.text.trim() && !attachments && !attachmentsUnavailable) continue;
    rows.push({
      id: item.id, text: item.text,
      paused: item.paused !== false || item.claimed === true || Boolean(attachments) || attachmentsUnavailable,
      claimed: item.claimed === true,
      ...(attachments ? { attachments } : {}),
      ...(attachmentsUnavailable ? { attachmentsUnavailable: true } : {}),
    });
  }
  return rows;
}

export function moveCued<T extends CuedMessage>(queue: T[], id: string, offset: -1 | 1): T[] {
  const index = queue.findIndex(item => item.id === id);
  if (index < 0 || index + offset < 0 || index + offset >= queue.length) return queue;
  const next = [...queue];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}
