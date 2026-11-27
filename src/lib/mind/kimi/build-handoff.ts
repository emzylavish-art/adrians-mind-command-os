import { isShareId } from "../app-location.ts";
import type { Chat, LocalFile, Msg } from "../types.ts";
import { MAX_BUILD_TASK_CHARACTERS } from "./build-guidance.ts";

export type BuildSelection = { chatId: string; messages: string[]; files: string[] };
export type ChatBuildHandoff = { owner: string; chatId: string; text: string; messageCount: number; fileCount: number };

export function buildHandoffKey(owner: string) {
  return `adrian-build-handoff.v1.${encodeURIComponent(owner)}`;
}

export function chatBuildFiles(chat: Chat, files: LocalFile[]) {
  return files.filter(file => !file.archived && !file.retrievalDisabled && file.text.trim() && (
    file.sourceChatId === chat.id || (chat.projectId !== null && file.projectId === chat.projectId)
    || chat.documentSources?.some(source => source.fileId === file.id)
  ));
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
  const chosenMessages = chat.messages.filter(message => messageIds.has(message.id) && buildMessageEligible(message));
  const chosenFiles = chatBuildFiles(chat, files).filter(file => fileIds.has(file.id));
  if (chosenMessages.length !== messageIds.size || chosenFiles.length !== fileIds.size) {
    return { error: "A selected item changed or is unavailable. Review your selection again." } as const;
  }
  if (!chosenMessages.length && !chosenFiles.length) return { error: "Choose at least one message or file." } as const;
  const text = [
    ...chosenMessages.map(message => `${message.role === "user" ? "Your message" : "Adrian’s reply"}\n${message.content}`),
    ...chosenFiles.map(file => `File · ${file.name}${file.partial ? " (retained excerpt)" : ""}\n${file.text}`),
  ].join("\n\n");
  if (text.length > MAX_BUILD_TASK_CHARACTERS) return { error: "The selection exceeds Build’s 8,000-character task limit. Select fewer items." } as const;
  return { handoff: { owner, chatId: chat.id, text, messageCount: chosenMessages.length, fileCount: chosenFiles.length } } as const;
}

export function parseChatBuildHandoff(raw: string | null, owner: string): ChatBuildHandoff | null {
  if (!raw) return null;
  const data = JSON.parse(raw) as Partial<ChatBuildHandoff> | null;
  const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
  if (!data || data.owner !== owner || !isShareId(data.chatId) || typeof data.text !== "string"
    || !data.text.trim() || data.text.length > MAX_BUILD_TASK_CHARACTERS || !validCount(data.messageCount)
    || !validCount(data.fileCount) || data.messageCount + data.fileCount === 0) return null;
  return { owner, chatId: data.chatId, text: data.text, messageCount: data.messageCount, fileCount: data.fileCount };
}
