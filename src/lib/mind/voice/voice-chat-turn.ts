import type { Chat, Msg, Workspace } from "../types.ts";

/** Pure helpers for persisting voice-mode turns into the chat thread. */

export type VoiceChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  model?: string;
};

export function buildVoiceChatTurn(input: {
  userText: string;
  assistantText: string;
  model?: string;
  nowIso?: string;
  idFactory?: () => string;
}): { user: VoiceChatMessage; assistant: VoiceChatMessage } | null {
  const userText = input.userText.trim();
  const assistantText = input.assistantText.trim();
  if (!userText || !assistantText) return null;
  const at = input.nowIso ?? new Date().toISOString();
  const id = input.idFactory ?? (() => crypto.randomUUID());
  return {
    user: { id: id(), role: "user", content: userText, at },
    assistant: {
      id: id(),
      role: "assistant",
      content: assistantText,
      at,
      model: input.model ?? "voice-direct",
    },
  };
}

/** PCM16 mono duration from raw byte length. */
export function pcm16MonoDurationMs(byteLength: number, sampleRate: number): number {
  if (byteLength <= 0 || sampleRate <= 0) return 0;
  const samples = Math.floor(byteLength / 2);
  return Math.round((samples / sampleRate) * 1000);
}

/** Reserve a destination for one call. The first transcript creates the chat, if needed.
 * Each update can be replayed by React. Later updates never restore a deleted thread. */
export function createCallHistory(existingChatId: string | null, makeChat: () => Chat) {
  let chatId = existingChatId;
  return (message: Msg): ((ws: Workspace) => Workspace) => {
    const newChat = chatId === null ? makeChat() : null;
    if (newChat) chatId = newChat.id;
    const id = chatId;
    return (ws) => {
      const chat = ws.chats.find((row) => row.id === id);
      if (chat) return { ...ws, chats: ws.chats.map((row) => row.id === id ? { ...row, messages: [...row.messages, message] } : row) };
      if (!newChat) return ws;
      return { ...ws, chats: [{ ...newChat, title: message.content.trim().slice(0, 48) || "Voice conversation", messages: [message] }, ...ws.chats] };
    };
  };
}

export type CallHistory = ReturnType<typeof createCallHistory>;
