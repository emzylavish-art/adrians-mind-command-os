import type { Msg, Workspace } from "./types.ts";

/** One durable draft per operation; a checkpoint never represents a completed reply. */
export function checkpointReply(ws: Workspace, chatId: string, operationId: string, text: string, status: "streaming" | "interrupted", at: string): Workspace {
  if (!text) return ws;
  return { ...ws, chats: ws.chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    const id = `partial:${operationId}`;
    if (chat.messages.some((message) => message.replyOperationId === operationId && message.replyStatus === "complete")) return chat;
    const prior = chat.messages.find((message) => message.id === id);
    const draft: Msg = { id, role: "assistant", content: text, at: prior?.at ?? at, replyStatus: status, replyOperationId: operationId };
    return { ...chat, messages: prior ? chat.messages.map((message) => message.id === id ? draft : message) : [...chat.messages, draft] };
  }) };
}

export function completedHistory<T extends { replyStatus?: string }>(messages: T[]): T[] {
  return messages.filter((message) => !message.replyStatus || message.replyStatus === "complete");
}
