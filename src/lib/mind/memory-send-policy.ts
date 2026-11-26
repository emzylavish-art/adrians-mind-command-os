import type { Chat, Workspace } from "./types.ts";
import { canonical, memoriesForChat } from "./workspace.ts";

/** Captures effective permission/content, not unrelated messages or UI selection. */
export function memorySendRevision(workspace: Workspace, chat: Chat): string {
  return canonical({
    chatId: chat.id, projectId: chat.projectId, memory: chat.memory,
    temporary: chat.temporary, botKnowledge: chat.botKnowledge ?? "",
    notes: memoriesForChat(workspace, chat).map(({ id, text, updatedAt, alwaysApply }) => ({ id, text, updatedAt, alwaysApply })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function checkMemorySendRevision(workspace: Workspace, chatId: string, revision: string): boolean {
  const chat = workspace.chats.find((item) => item.id === chatId);
  return !!chat && memorySendRevision(workspace, chat) === revision;
}
