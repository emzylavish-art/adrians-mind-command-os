import type { Workspace } from "./types.ts";
import { memoriesForChat } from "./workspace.ts";

/** Capture only eligible context after preparation; compare again immediately before dispatch. */
export function currentMemoryContext(ws: Workspace, chatId: string) {
  const chat = ws.chats.find((item) => item.id === chatId);
  if (!chat) return null;
  const notes = memoriesForChat(ws, chat);
  return { chat, notes, permissionKey: JSON.stringify([chat.id, chat.projectId, chat.memory, chat.temporary,
    notes.map((note) => [note.id, note.text, note.updatedAt]),
    ws.files.filter((file) => chat.projectId && file.projectId === chat.projectId).map((file) => [file.id, file.text])]) };
}
