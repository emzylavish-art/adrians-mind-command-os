import { isShareId } from "../app-location.ts";
import type { Chat, LocalFile, Msg } from "../types.ts";
import { MAX_BUILD_TASK_CHARACTERS } from "./build-guidance.ts";
import { MAX_IMAGES_PER_TURN } from "../media/types.ts";

export type WorkImageRef = { messageId: string; index: number; name: string; imageId?: string };
export type WorkOriginalRef = { fileId: string; name: string; sha256: string };
export type WorkMedia = { images: WorkImageRef[]; originals: WorkOriginalRef[] };
export type BuildSelection = { chatId: string; messages: string[]; files: string[]; images?: string[] };
export type ChatBuildHandoff = { owner: string; chatId: string; projectId: string | null; text: string; messageCount: number; fileCount: number; media?: WorkMedia };

export function buildHandoffKey(owner: string) {
  return `adrian-build-handoff.v1.${encodeURIComponent(owner)}`;
}

export function chatBuildFiles(chat: Chat, files: LocalFile[]) {
  return files.filter(file => !file.archived && !file.retrievalDisabled && (file.original || file.text.trim()) && (
    file.sourceChatId === chat.id || (chat.projectId !== null && file.projectId === chat.projectId)
    || chat.documentSources?.some(source => source.fileId === file.id)
  ));
}

export function workImageKey(image: Pick<WorkImageRef, "messageId" | "index">) {
  return `${image.messageId}:${image.index}`;
}

export function chatBuildImages(chat: Chat): WorkImageRef[] {
  return chat.messages.flatMap(message => {
    if (message.kind === "error" || message.delivery || message.replyStatus && message.replyStatus !== "complete") return [];
    return (message.images ?? []).flatMap((image, index) => image.blobId || image.dataUrl?.startsWith("data:image/") ? [{ messageId: message.id, index, name: image.name || `Image ${index + 1}`, imageId: image.blobId || image.assetId }] : []);
  });
}

export function normalizeWorkMedia(value: unknown): WorkMedia | undefined {
  const media = value as Partial<WorkMedia> | null;
  if (!media || !Array.isArray(media.images) || !Array.isArray(media.originals)) return undefined;
  const images = media.images.filter(row => isShareId(row?.messageId) && Number.isSafeInteger(row.index) && row.index >= 0 && typeof row.name === "string" && (row.imageId === undefined || typeof row.imageId === "string")).slice(0, MAX_IMAGES_PER_TURN);
  const originals = media.originals.filter(row => isShareId(row?.fileId) && typeof row.name === "string" && /^[a-f0-9]{64}$/.test(row.sha256));
  return images.length || originals.length ? { images, originals } : undefined;
}

export function buildMessageEligible(message: Msg) {
  return Boolean(message.content.trim() && !message.delivery && message.kind !== "error"
    && (!message.replyStatus || message.replyStatus === "complete"));
}

export function prepareChatBuildHandoff(owner: string, chat: Chat | undefined, files: LocalFile[], selection: BuildSelection) {
  if (!owner || !chat || chat.id !== selection.chatId || !isShareId(chat.id) || chat.temporary || chat.archived) {
    return { error: "This conversation is unavailable for a saved Build handoff." } as const;
  }
  const messageIds = new Set(selection.messages);
  const fileIds = new Set(selection.files);
  const imageIds = new Set(selection.images ?? []);
  const chosenMessages = chat.messages.filter(message => messageIds.has(message.id) && buildMessageEligible(message));
  const chosenFiles = chatBuildFiles(chat, files).filter(file => fileIds.has(file.id));
  const chosenImages = chatBuildImages(chat).filter(image => imageIds.has(workImageKey(image)));
  if (chosenMessages.length !== messageIds.size || chosenFiles.length !== fileIds.size || chosenImages.length !== imageIds.size) {
    return { error: "A selected item changed or is unavailable. Review your selection again." } as const;
  }
  if (!chosenMessages.length && !chosenFiles.length && !chosenImages.length) return { error: "Choose at least one message, file, or image." } as const;
  if (chosenImages.length > MAX_IMAGES_PER_TURN) return { error: "Choose up to four images for planning." } as const;
  const text = [
    ...chosenMessages.map(message => `${message.role === "user" ? "Your message" : "Adrian’s reply"}\n${message.content}`),
    ...chosenFiles.map(file => file.text.trim() ? `File · ${file.name}${file.partial ? " (retained excerpt)" : ""}\n${file.text}` : `Original file for review · ${file.name}`),
    ...chosenImages.map(image => `Image for planning · ${image.name}`),
  ].join("\n\n");
  if (text.length > MAX_BUILD_TASK_CHARACTERS) return { error: "The selection exceeds Build’s 8,000-character task limit. Select fewer items." } as const;
  const media = normalizeWorkMedia({ images: chosenImages, originals: chosenFiles.flatMap(file => file.original ? [{ fileId: file.id, name: file.name, sha256: file.original.sha256 }] : []) });
  return { handoff: { owner, chatId: chat.id, projectId: chat.projectId, text, messageCount: chosenMessages.length, fileCount: chosenFiles.length, ...(media ? { media } : {}) } } as const;
}

export function parseChatBuildHandoff(raw: string | null, owner: string): ChatBuildHandoff | null {
  if (!raw) return null;
  const data = JSON.parse(raw) as Partial<ChatBuildHandoff> | null;
  const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
  const media = normalizeWorkMedia(data?.media);
  if (!data || data.owner !== owner || !isShareId(data.chatId) || typeof data.text !== "string"
    || !data.text.trim() || data.text.length > MAX_BUILD_TASK_CHARACTERS || !validCount(data.messageCount)
    || !validCount(data.fileCount) || data.messageCount + data.fileCount + (media?.images.length ?? 0) === 0) return null;
  if (data.projectId != null && !isShareId(data.projectId)) return null;
  return { owner, chatId: data.chatId, projectId: data.projectId ?? null, text: data.text, messageCount: data.messageCount, fileCount: data.fileCount, ...(media ? { media } : {}) };
}
