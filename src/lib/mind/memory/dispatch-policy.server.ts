import type { Sql } from "../../db.ts";
import { readSnapshot } from "../store.ts";
import { emptyWorkspace, normalizeWorkspace, workspaceForChat } from "../workspace.ts";
import type { Workspace } from "../types.ts";
import { validateMemoryDispatch, type MemoryDispatchBody, type MemoryPolicyResult } from "./dispatch-policy.ts";

/** Re-read the owner snapshot at every new provider dispatch, never trust cached request notes. */
export async function assertCurrentMemoryContext(ownerId: string, body: MemoryDispatchBody, sql?: Sql): Promise<MemoryPolicyResult> {
  // Requests carrying no account context remain available during a storage outage.
  if (!body.chatId && !Array.isArray(body.memoryContext) && !body.saveMemory && !body.projectContext && !body.botKnowledge) return { ok: true };
  if (!body.chatId && Array.isArray(body.memoryContext) && body.memoryContext.length === 0 && !body.saveMemory && !body.projectContext && !body.botKnowledge) return { ok: true };
  try {
    const database = sql ?? await (await import("../../db.ts")).getSql();
    return await validateMemoryDispatch(normalizeWorkspace(await readSnapshot(database, ownerId)), body);
  } catch {
    return { ok: false, code: "context_unavailable", error: "Current conversation privacy could not be verified. Your message was kept; no new model request was sent." };
  }
}

export type AgentContextBody = MemoryDispatchBody & { projects?: unknown; chats?: unknown; notes?: unknown };

/** The planner may request a subset of current account context, but cannot
 * manufacture globally scoped notes or synthetic project identities itself. */
export async function readAuthorizedAgentContext(ownerId: string, body: AgentContextBody, sql?: Sql): Promise<{ ok: true; workspace: Workspace } | Exclude<MemoryPolicyResult, { ok: true }>> {
  const denied = (): Exclude<MemoryPolicyResult, { ok: true }> => ({ ok: false, code: "context_changed", error: "Planner context changed or is no longer permitted. Refresh the conversation before starting another step; no new model request was sent." });
  const requested = (value: unknown): string[] | null => value === undefined ? [] : Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  const projects = requested(body.projects), chats = requested(body.chats), notes = requested(body.notes);
  if (!projects || !chats || !notes) return denied();
  if (!body.chatId) return projects.length || chats.length || notes.length ? denied() : { ok: true, workspace: emptyWorkspace() };
  try {
    const database = sql ?? await (await import("../../db.ts")).getSql();
    const workspace = normalizeWorkspace(await readSnapshot(database, ownerId));
    const chat = workspace.chats.find((item) => item.id === body.chatId);
    if (!chat) return denied();
    const policy = await validateMemoryDispatch(workspace, body);
    if (!policy.ok) return policy;
    const allowed = workspaceForChat(workspace, chat);
    if (projects.some((name) => !allowed.projects.some((project) => project.name === name))
      || chats.some((title) => !allowed.chats.some((thread) => thread.title === title))
      || notes.some((text) => !allowed.memories.some((note) => note.text === text))) return denied();
    return { ok: true, workspace: { ...emptyWorkspace(), halted: workspace.halted, toolPermissions: workspace.toolPermissions,
      projects: allowed.projects.filter((project) => projects.includes(project.name)).slice(0, 20),
      chats: allowed.chats.filter((thread) => chats.includes(thread.title)).slice(0, 20),
      memories: allowed.memories.filter((note) => notes.includes(note.text)).slice(0, 12),
    } };
  } catch {
    return { ok: false, code: "context_unavailable", error: "Current planner context could not be verified. No new model request was sent." };
  }
}
