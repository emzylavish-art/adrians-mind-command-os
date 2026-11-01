import type { Sql } from "../../db.ts";
import type { MemoryItem, MemoryScope, Workspace } from "../types.ts";
import { readSnapshot, writeSnapshot } from "../store.ts";
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
  const text = sanitizeMemoryText(input.text);
  if (!isStorableMemoryText(text)) return { ok: false, error: "Memory text is empty." };
  const payload = await readSnapshot(sql, userId);
  let ws = loadOwnerWorkspace(payload);
  const before = new Set(ws.memories.map((item) => item.id));
  ws = addMemory(ws, {
    scope: input.scope,
    text,
    source: (input.source ?? "owner").slice(0, 160),
    projectId: input.projectId ?? null,
    chatId: input.chatId ?? null,
  });
  const item = ws.memories.find((note) => !before.has(note.id));
  if (!item) return { ok: false, error: "Memory was not stored." };
  await writeSnapshot(sql, userId, ws);
  return { ok: true, item };
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
  const payload = await readSnapshot(sql, userId);
  const ws = loadOwnerWorkspace(payload);
  const existing = ws.memories.find((item) => item.id === id);
  if (!existing) return { ok: false, error: "Memory not found." };
  const revised = reviseMemory(ws, id, next);
  const item = revised.memories.find((note) => note.id === id);
  if (!item) return { ok: false, error: "Memory not found." };
  await writeSnapshot(sql, userId, revised);
  return { ok: true, item };
}

export async function deleteOwnerMemory(
  sql: Sql,
  userId: string,
  id: string,
): Promise<{ ok: true; deletedId: string } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Memory id is required." };
  const payload = await readSnapshot(sql, userId);
  const ws = loadOwnerWorkspace(payload);
  if (!ws.memories.some((item) => item.id === id)) return { ok: false, error: "Memory not found." };
  const next = deleteMemory(ws, id);
  await writeSnapshot(sql, userId, next);
  return { ok: true, deletedId: id };
}
