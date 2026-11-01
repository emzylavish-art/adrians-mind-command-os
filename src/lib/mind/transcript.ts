import type { Chat, MsgImage, Workspace } from "./types.ts";
import { stripAttachedStub } from "./media/history.ts";

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
  const nextText = text.trim().slice(0, 8000);
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
    version: 1,
    exportedAt: new Date().toISOString(),
    chat: {
      id: chat.id,
      title: chat.title,
      memory: chat.memory,
      messages: chat.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        at: msg.at,
        model: msg.model ?? null,
        images: msg.images?.map((image) => ({ dataUrl: image.dataUrl, name: image.name ?? null })) ?? undefined,
      })),
    },
  };
  return { filename: `chat-${chat.id}.json`, json: JSON.stringify(payload, null, 2) };
}
