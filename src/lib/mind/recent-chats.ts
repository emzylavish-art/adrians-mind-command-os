import type { Chat } from "./types";

/** Return the most recently active chats without mutating workspace order or inventing timestamps. */
export function getRecentChats(chats: readonly Chat[], limit = 5, excludedChatIds: ReadonlySet<string> = new Set()): Chat[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return chats
    .filter((chat) => !excludedChatIds.has(chat.id))
    .map((chat, index) => ({ chat, index, latest: latestMessageTime(chat) }))
    .sort((a, b) => b.latest - a.latest || a.index - b.index)
    .slice(0, Math.floor(limit))
    .map(({ chat }) => chat);
}

function latestMessageTime(chat: Chat): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const message of chat.messages) {
    const at = Date.parse(message.at);
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}
