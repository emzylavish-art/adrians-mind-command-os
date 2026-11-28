import { shareWriteForView, writeShareSearch } from "./app-location.ts";
import { addSchedule, setScheduleEnabled } from "./fleet.ts";
import type { Chat, Workspace } from "./types.ts";
import { createChat } from "./workspace.ts";

export const CONVERSATION_ACTIONS = [
  { id: "project", label: "Add to project" },
  { id: "copy", label: "Copy task link" },
  { id: "share-text", label: "Share conversation text" },
  { id: "rename", label: "Rename" },
  { id: "files", label: "View all files" },
  { id: "scheduled", label: "Scheduled" },
  { id: "pin", label: "Pin" },
  { id: "favorite", label: "Favorite" },
  { id: "archive", label: "Archive" },
  { id: "quote", label: "Quote in new task" },
  { id: "delete", label: "Delete" },
] as const;

export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number]["id"];

export function conversationSharePath(chatId: string, knownSections: readonly string[]) {
  return writeShareSearch("", shareWriteForView("chat", {
    chat: chatId,
    project: null,
    file: null,
    bot: null,
  }), knownSections);
}

export function applyFavorite(ws: Workspace, ids: readonly string[], favorite: boolean): Workspace {
  const chosen = new Set(ids);
  return { ...ws, chats: ws.chats.map((chat) => (chosen.has(chat.id) ? { ...chat, favorite } : chat)) };
}

export function applyArchive(ws: Workspace, ids: readonly string[], archived: boolean): Workspace {
  const chosen = new Set(ids);
  return { ...ws, chats: ws.chats.map((chat) => (chosen.has(chat.id) ? { ...chat, archived } : chat)) };
}

export function applyProject(ws: Workspace, ids: readonly string[], projectId: string | null): Workspace {
  const chosen = new Set(ids);
  return {
    ...ws,
    chats: ws.chats.map((chat) => chosen.has(chat.id) ? { ...chat, projectId } : chat),
    memories: ws.memories.map((note) => note.scope === "chat" && note.chatId && chosen.has(note.chatId)
      ? { ...note, projectId, updatedAt: new Date().toISOString() } : note),
  };
}

export function applyRename(ws: Workspace, ids: readonly string[], title: string): Workspace | null {
  const next = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!next) return null;
  const chosen = ids.filter((id) => ws.chats.some((chat) => chat.id === id));
  if (chosen.length === 0) return null;
  const names = new Map(chosen.map((id, index) => [id, chosen.length === 1 ? next : `${next} ${index + 1}`.slice(0, 80)]));
  return { ...ws, chats: ws.chats.map((chat) => (names.has(chat.id) ? { ...chat, title: names.get(chat.id)! } : chat)) };
}

export function quoteText(chat: { title: string; messages?: { id?: string; role?: string; content?: string }[] }, messageId?: string) {
  const messages = (chat.messages ?? []).filter((message) => message.content?.trim());
  const selected = messageId ? messages.filter((message) => message.id === messageId) : messages.slice(-6);
  const lines = selected.map((message) => `${message.role === "assistant" ? "Assistant" : "Owner"}: ${message.content!.trim()}`);
  const body = lines.join("\n\n") || chat.title;
  const excerpt = body.length > 1800 ? body.slice(0, 1800) + "\n[Excerpt shortened; open the source conversation for the full record.]" : body;
  return `Quoted from ${chat.title}${messageId ? " (selected message)" : " (recent conversation excerpt)"}:\n${excerpt}`;
}

export function quoteIntoNewChat(ws: Workspace, source: Chat): { ws: Workspace; chatId: string } {
  const made = createChat(ws, {
    memory: source.memory,
    autonomy: source.autonomy,
    temporary: source.temporary,
    projectId: source.projectId,
    personalityId: source.personalityId,
    customPersonality: source.customPersonality,
  });
  const quoted: Chat = {
    ...made.chat,
    title: `Quote: ${source.title}`.slice(0, 80),
    quotedFrom: { chatId: source.id, messageIds: source.messages.map((message) => message.id), quotedAt: new Date().toISOString() },
    messages: [{ id: crypto.randomUUID(), role: "user", content: quoteText(source), at: new Date().toISOString() }],
  };
  return {
    chatId: quoted.id,
    ws: { ...made.ws, chats: made.ws.chats.map((chat) => (chat.id === quoted.id ? quoted : chat)) },
  };
}

export function scheduleConversation(ws: Workspace, name: string, chatId?: string): { ws: Workspace; created: boolean; error?: string } {
  if (chatId && !ws.chats.some((chat) => chat.id === chatId && !chat.temporary)) {
    return { ws, created: false, error: "Choose a saved conversation before scheduling." };
  }
  const title = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return { ws, created: false, error: "Name the schedule." };
  if (ws.schedules.some((job) => chatId ? job.chatId === chatId : !job.chatId && job.name === title)) return { ws, created: false };
  const added = addSchedule(ws, title, null, 1440);
  if (!added.ok) return { ws, created: false, error: added.error };
  const job = added.ws.schedules[0];
  const saved = setScheduleEnabled(added.ws, job.id, false);
  return { ws: { ...saved, schedules: saved.schedules.map((entry) => entry.id === job.id ? { ...entry, chatId } : entry) }, created: true };
}

export function visibleConversations<T extends { archived?: boolean }>(chats: readonly T[], includeArchived = false) {
  return includeArchived ? [...chats] : chats.filter((chat) => chat.archived !== true);
}
