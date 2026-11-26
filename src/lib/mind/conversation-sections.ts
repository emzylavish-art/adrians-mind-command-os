export const CONVERSATION_SECTIONS = ["Today", "Yesterday", "This week", "Earlier"] as const;

export type ConversationSection = (typeof CONVERSATION_SECTIONS)[number];

export const HIDDEN_SETTINGS_SECTIONS_KEY = "adrian-hidden-settings-sections";

type TimedChat = { messages?: { at?: string }[] };

export function conversationSection(chat: TimedChat, now = new Date()): ConversationSection {
  const iso = chat.messages?.[0]?.at;
  if (!iso) return "Today";
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return "Today";
  day.setHours(0, 0, 0, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diff = (start.getTime() - day.getTime()) / 86_400_000;
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 7) return "This week";
  return "Earlier";
}

export function groupConversationSections<T extends TimedChat>(chats: readonly T[], now = new Date()) {
  return CONVERSATION_SECTIONS
    .map((label) => ({ label, items: chats.filter((chat) => conversationSection(chat, now) === label) }))
    .filter((group) => group.items.length > 0);
}

export function removeConversations<T extends { chats: { id: string }[]; pins: { kind: string; ref: string }[]; deletedChatIds?: string[] }>(ws: T, ids: readonly string[]): T {
  const gone = new Set(ids);
  return {
    ...ws,
    deletedChatIds: [...new Set([...(ws.deletedChatIds ?? []), ...ws.chats.filter((chat) => gone.has(chat.id)).map((chat) => chat.id)])],
    chats: ws.chats.filter((chat) => !gone.has(chat.id)),
    pins: ws.pins.filter((pin) => !(pin.kind === "chat" && gone.has(pin.ref))),
  };
}

export function readHiddenSections(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
  } catch {
    return [];
  }
}

export function hideSection(current: readonly string[], name: string): string[] {
  return current.includes(name) ? [...current] : [...current, name];
}

export function restoreSection(current: readonly string[], name: string): string[] {
  return current.filter((item) => item !== name);
}
