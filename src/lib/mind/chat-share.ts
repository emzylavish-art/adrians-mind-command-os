import type { Chat } from "./types.ts";

export type SharedText = { title: string; messages: { role: "user" | "assistant"; text: string }[] };
export function shareableChatText(chat: Chat): SharedText | null {
  if (chat.temporary) return null;
  const messages = chat.messages.filter(message => message.content.trim() && !message.kind && !message.delivery && (!message.replyStatus || message.replyStatus === "complete"))
    .map(message => ({ role: message.role, text: message.content }));
  if (!messages.length) return null;
  return { title: chat.title, messages };
}
export async function chatTextDigest(text: SharedText) {
  const bytes = new TextEncoder().encode(JSON.stringify(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}
