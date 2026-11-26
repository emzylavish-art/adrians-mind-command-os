import type { Chat, Workspace } from "../types.ts";
import { canonical, memoriesForChat, sha256, workspaceForChat } from "../workspace.ts";
import { eveAccessNotes } from "../eve-access.ts";
import { effectiveContextPolicy } from "./context-policy.ts";
import { validateProjectPassages } from "../knowledge.ts";

export type MemoryDispatchBody = {
  chatId?: unknown;
  memory?: unknown;
  memoryContext?: unknown;
  memoryPolicyRevision?: unknown;
  contextPolicy?: unknown;
  history?: unknown;
  botKnowledge?: unknown;
  saveMemory?: unknown;
  projectContext?: unknown;
};

export async function memoryPolicyRevision(workspace: Workspace, chat: Chat): Promise<string> {
  return sha256(canonical({ chatId: chat.id, memory: chat.memory, temporary: chat.temporary, projectId: chat.projectId,
    contextPolicy: effectiveContextPolicy(chat), botKnowledge: chat.botKnowledge ?? "",
    notes: memoriesForChat(workspace, chat).map(({ id, text, updatedAt, scope, projectId, chatId }) => ({ id, text, updatedAt, scope, projectId, chatId })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

export type MemoryPolicyResult = { ok: true } | { ok: false; code: "context_changed" | "context_unavailable"; error: string };
const changed = (): MemoryPolicyResult => ({ ok: false, code: "context_changed", error: "Conversation privacy or saved context changed. Refresh the conversation before a new send. Your message was kept; revoked context was not sent." });

/** Shared client retry + server pre-dispatch check. Never authorizes provider dispatch itself. */
export async function validateMemoryDispatch(workspace: Workspace, body: MemoryDispatchBody): Promise<MemoryPolicyResult> {
  const context = Array.isArray(body.memoryContext) ? body.memoryContext : [];
  const requestedSavedData = context.length > 0 || (typeof body.saveMemory === "string" && body.saveMemory.trim().length > 0);
  const requestedProjectData = Array.isArray(body.projectContext) && body.projectContext.length > 0;
  const requestedBotData = typeof body.botKnowledge === "string" && body.botKnowledge.trim().length > 0;
  const chat = typeof body.chatId === "string" ? workspace.chats.find((item) => item.id === body.chatId) : undefined;
  if (!chat) return requestedSavedData || requestedProjectData || requestedBotData
    ? { ok: false, code: "context_unavailable", error: "Save this conversation to your account before using saved context. No model was called." }
    : { ok: true };
  const policy = effectiveContextPolicy(chat);
  if (!(await validateProjectPassages(workspace, chat, body.projectContext))) return changed();
  if (chat.agentId) {
    const agent = workspace.agents.find((item) => item.id === chat.agentId);
    // Revoked data permissions apply immediately even while a conversation pins old instructions.
    if ((!agent || agent.archived || agent.memory !== "on") && requestedSavedData) return changed();
    if ((!agent || agent.archived || (chat.botRevision !== agent.version && chat.botKnowledge !== agent.knowledge)) && typeof body.botKnowledge === "string" && body.botKnowledge.trim()) return changed();
  }
  if ((chat.memory !== "on" || chat.temporary) && requestedSavedData) return changed();
  if (!policy.history && Array.isArray(body.history) && body.history.length) return changed();
  if (!policy.botKnowledge && typeof body.botKnowledge === "string" && body.botKnowledge.trim()) return changed();
  if (typeof body.botKnowledge === "string" && body.botKnowledge.trim() && body.botKnowledge !== chat.botKnowledge) return changed();
  if (!policy.saveMemories && typeof body.saveMemory === "string" && body.saveMemory.trim()) return changed();
  if (body.memoryPolicyRevision !== undefined && body.memoryPolicyRevision !== await memoryPolicyRevision(workspace, chat)) return changed();
  // Legacy clients must still obey current notes and scope even without a revision.
  const allowed = new Map([...memoriesForChat(workspace, chat), ...eveAccessNotes(workspaceForChat(workspace, chat))].map((note) => [note.id, note.text]));
  for (const note of context) {
    if (!note || typeof note !== "object") return changed();
    const item = note as { id?: unknown; text?: unknown };
    if (typeof item.id !== "string" || typeof item.text !== "string" || allowed.get(item.id) !== item.text) return changed();
  }
  return { ok: true };
}
