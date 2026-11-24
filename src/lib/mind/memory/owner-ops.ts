import type { Sql } from "../../db.ts";
import type { MemoryItem, MemoryScope, Workspace } from "../types.ts";
import { readSnapshot, updateOwnerWorkspace } from "../store.ts";
import { addMemory, deleteMemory, normalizeWorkspace, reviseMemory } from "../workspace.ts";
import { isStorableMemoryText, sanitizeMemoryText } from "./sanitize.ts";

function loadOwnerWorkspace(payload: unknown | null): Workspace {
  return normalizeWorkspace(payload);
}

export type OwnerMemoryList = {
  ok: true;
  memories: MemoryItem[];
};

export async function listOwnerMemories(
  sql: Sql,
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<OwnerMemoryList> {
  const payload = await readSnapshot(sql, userId);
  const ws = loadOwnerWorkspace(payload);
  const memories = ws.memories.filter((item) => (opts.includeArchived ? true : !item.archived));
  return { ok: true, memories };
}

export async function createOwnerMemory(
  sql: Sql,
  userId: string,
  input: {
    scope: MemoryScope;
    text: string;
    source?: string;
    projectId?: string | null;
    chatId?: string | null;
  },
): Promise<{ ok: true; item: MemoryItem } | { ok: false; error: string }> {
  if ((input.scope === "chat" && !input.chatId?.trim()) || (input.scope === "project" && !input.projectId?.trim())) {
    return { ok: false, error: "Select a target for this memory scope." };
  }
  const text = sanitizeMemoryText(input.text);
  if (!isStorableMemoryText(text)) return { ok: false, error: "Memory text is empty." };
  return updateOwnerWorkspace<Awaited<ReturnType<typeof createOwnerMemory>>>(sql, userId, (ws) => {
    const workspace = addMemory(ws, {
      scope: input.scope, text, source: (input.source ?? "owner").slice(0, 160),
      projectId: input.projectId ?? null, chatId: input.chatId ?? null,
    });
    return { workspace, result: { ok: true, item: workspace.memories[0] } };
  });
}

export async function editOwnerMemory(
  sql: Sql,
  userId: string,
  id: string,
  text: string,
): Promise<{ ok: true; item: MemoryItem } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Memory id is required." };
  const next = sanitizeMemoryText(text);
  if (!isStorableMemoryText(next)) return { ok: false, error: "Memory text is empty." };
  return updateOwnerWorkspace<Awaited<ReturnType<typeof editOwnerMemory>>>(sql, userId, (ws) => {
    const workspace = reviseMemory(ws, id, next);
    const item = workspace.memories.find((note) => note.id === id);
    if (!item) return { result: { ok: false, error: "Memory not found." } };
    return { workspace, result: { ok: true, item } };
  });
}

export async function deleteOwnerMemory(
  sql: Sql,
  userId: string,
  id: string,
): Promise<{ ok: true; deletedId: string } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Memory id is required." };
  return updateOwnerWorkspace<Awaited<ReturnType<typeof deleteOwnerMemory>>>(sql, userId, (ws) => {
    if (!ws.memories.some((item) => item.id === id)) return { result: { ok: false, error: "Memory not found." } };
    return { workspace: deleteMemory(ws, id), result: { ok: true, deletedId: id } };
  });
}
