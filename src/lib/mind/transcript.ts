import type { Chat, Msg, MsgImage, ReplyVersion, Workspace } from "./types.ts";
import { stripAttachedStub } from "./media/history.ts";
import { canonical, sha256 } from "./workspace.ts";

export function renameChat(ws: Workspace, chatId: string, title: string): Workspace | null {
  const next = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!next) return null;
  if (!ws.chats.some((chat) => chat.id === chatId)) return null;
  return { ...ws, chats: ws.chats.map((chat) => (chat.id === chatId ? { ...chat, title: next } : chat)) };
}

export function reviseUserTurn(
  ws: Workspace,
  chatId: string,
  messageId: string,
  text: string,
): { ws: Workspace; chat: Chat; text: string; images: MsgImage[] } | { error: string } {
  const chat = ws.chats.find((item) => item.id === chatId);
  if (!chat) return { error: "That chat is gone." };
  const index = chat.messages.findIndex((msg) => msg.id === messageId);
  if (index < 0) return { error: "That message is gone." };
  if (chat.messages[index]?.role !== "user") return { error: "Only your messages can be edited." };
  const nextText = text.trim();
  if (nextText.length > 8000) return { error: "This message exceeds 8,000 characters. Shorten it or attach the full document. Your draft has not been truncated." };
  if (!nextText) return { error: "Write a message first." };
  const prior = chat.messages[index]!;
  const images = prior.images ? [...prior.images] : [];
  const edited = { ...prior, content: nextText, images: images.length ? images : undefined };
  const nextChat: Chat = {
    ...chat,
    title: index === 0 ? nextText.replace(/\s+/g, " ").slice(0, 48) : chat.title,
    messages: [...chat.messages.slice(0, index), edited],
  };
  return {
    ws: { ...ws, chats: ws.chats.map((item) => (item.id === chatId ? nextChat : item)) },
    chat: nextChat,
    text: nextText,
    images,
  };
}

export function prepareRegenerate(
  ws: Workspace,
  chatId: string,
): { ws: Workspace; chat: Chat; text: string; images: MsgImage[] } | { error: string } {
  const chat = ws.chats.find((item) => item.id === chatId);
  if (!chat) return { error: "That chat is gone." };
  const last = chat.messages.at(-1);
  if (!last || last.role !== "assistant") return { error: "There is no reply to regenerate." };
  const messages = chat.messages.slice(0, -1);
  const user = messages.at(-1);
  if (!user || user.role !== "user") return { error: "The reply has no message to answer again." };
  const images = user.images ? [...user.images] : [];
  const text = stripAttachedStub(user.content) || user.content;
  const nextChat: Chat = { ...chat, messages };
  return {
    ws: { ...ws, chats: ws.chats.map((item) => (item.id === chatId ? nextChat : item)) },
    chat: nextChat,
    text,
    images,
  };
}

export function prepareRetry(
  ws: Workspace,
  chatId: string,
): { chat: Chat; text: string; images: MsgImage[] } | { error: string } {
  const chat = ws.chats.find((item) => item.id === chatId);
  if (!chat) return { error: "That chat is gone." };
  const last = chat.messages.at(-1);
  if (!last) return { error: "There is no message to retry." };
  if (last.role !== "user") return { error: "Use regenerate for the last reply." };
  const images = last.images ? [...last.images] : [];
  const text = stripAttachedStub(last.content) || last.content;
  return { chat, text, images };
}

export function exportChat(ws: Workspace, chatId: string): { filename: string; json: string } | { error: string } {
  const chat = ws.chats.find((item) => item.id === chatId);
  if (!chat) return { error: "That chat is gone." };
  const payload = {
    kind: "adrians-mind-chat",
    version: 2,
    exportKind: "structured-transcript",
    limitations: ["Provider credentials and active execution authorization are excluded.", "Blob identifiers and temporary video links are references; their bytes may require a separate media export.", "Use a workspace archive for restoration."],
    exportedAt: new Date().toISOString(),
    chat: {
      id: chat.id,
      title: chat.title,
      memory: chat.memory,
      temporary: chat.temporary,
      projectId: chat.projectId,
      retrievalLog: chat.retrievalLog,
      ...(chat.checkpoints ? { checkpoints: chat.checkpoints } : {}),
      ...(chat.knowledgeDocumentIds ? { knowledgeDocumentIds: chat.knowledgeDocumentIds } : {}),
      ...(chat.branchFrom ? { branchFrom: chat.branchFrom } : {}),
      ...(chat.quotedFrom ? { quotedFrom: chat.quotedFrom } : {}),
      messages: chat.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        ...(msg.researchRefs ? { researchRefs: msg.researchRefs } : {}),
        ...(msg.contextReceipt ? { contextReceipt: msg.contextReceipt } : {}),
        ...(msg.inheritedFrom ? { inheritedFrom: msg.inheritedFrom } : {}),
        ...(msg.replyVersions ? { replyVersions: msg.replyVersions, selectedReplyVersionId: msg.selectedReplyVersionId } : {}),
        ...(msg.deliveryOperationId ? { deliveryOperationId: msg.deliveryOperationId, delivery: msg.delivery } : {}),
        ...(msg.partialReply ? { partialReply: msg.partialReply } : {}),
        ...(msg.memoryUsedIds ? { memoryUsedIds: msg.memoryUsedIds } : {}),
        content: msg.content,
        at: msg.at,
        model: msg.model ?? null,
        provider: msg.provider ?? null,
        requestedModel: msg.requestedModel ?? null,
        ...(msg.videoUrl ? { videoUrl: msg.videoUrl } : {}),
        images: msg.images
          ?.map((image) => ({
            dataUrl: image.dataUrl,
            blobId: image.blobId,
            name: image.name ?? null,
            mime: image.mime ?? null,
          }))
          .filter((image) => Boolean(image.dataUrl) || Boolean(image.blobId)) ?? undefined,
      })),
    },
  };
  return { filename: `chat-${chat.id}.json`, json: JSON.stringify(payload, null, 2) };
}


/** Copy completed history as provenance, never as an active delivery operation. */
export async function createEditedBranch(ws: Workspace, chatId: string, messageId: string, text: string): Promise<
  { ws: Workspace; chat: Chat; text: string; images: MsgImage[] } | { error: string }
> {
  const source = ws.chats.find((chat) => chat.id === chatId);
  const revised = reviseUserTurn(ws, chatId, messageId, text);
  if ("error" in revised || !source) return revised;
  const createdAt = new Date().toISOString();
  const branch: Chat = {
    ...revised.chat, id: crypto.randomUUID(), title: `${source.title.slice(0, 68)} (edited)`,
    branchFrom: { chatId, messageId, reason: "edit", createdAt, sourceRevision: await sha256(canonical(source)) },
    messages: revised.chat.messages.map((message) => {
      const { deliveryOperationId: _operation, deliveryRoute: _route, delivery: _delivery, partialReply: _partial, memorySaved: _saved, savedMemoryId: _savedId, ...history } = message;
      return { ...history, id: crypto.randomUUID(), inheritedFrom: { chatId, messageId: message.id } };
    }),
  };
  return { ws: { ...ws, chats: [branch, ...ws.chats] }, chat: branch, text: revised.text, images: revised.images };
}

function replyVersion(message: Msg): ReplyVersion {
  const { content, at, provider, model, requestedModel, routingMode, memoryUsedIds, images, videoUrl } = message;
  return { id: message.selectedReplyVersionId ?? message.id, content, at, provider, model, requestedModel, routingMode, memoryUsedIds, images, videoUrl };
}

/** Commit only after regeneration succeeds; failures leave the current answer intact. */
export function withReplyVersion(previous: Msg | undefined, replacement: Msg): Msg {
  if (!previous || previous.role !== "assistant" || replacement.role !== "assistant") return replacement;
  const versions = new Map((previous.replyVersions ?? []).map((version) => [version.id, version]));
  const before = replyVersion(previous);
  const after = replyVersion(replacement);
  versions.set(before.id, before);
  versions.set(after.id, after);
  return { ...replacement, replyVersions: [...versions.values()], selectedReplyVersionId: after.id };
}

/** The active message is the selected answer; context builders need no special fallback. */
export function selectReplyVersion(ws: Workspace, chatId: string, messageId: string, versionId: string): Workspace {
  return { ...ws, chats: ws.chats.map((chat) => chat.id !== chatId ? chat : {
    ...chat, messages: chat.messages.map((message) => {
      if (message.id !== messageId || message.role !== "assistant") return message;
      const version = message.replyVersions?.find((item) => item.id === versionId);
      if (!version) return message;
      return { ...message, ...version, id: message.id, provider: version.provider, model: version.model, requestedModel: version.requestedModel, routingMode: version.routingMode, images: version.images, videoUrl: version.videoUrl, memoryUsedIds: version.memoryUsedIds, memorySaved: undefined, savedMemoryId: undefined, selectedReplyVersionId: version.id };
    }),
  }) };
}
