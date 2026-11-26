import type { Workspace } from "./types.ts";
import { canonical } from "./workspace.ts";

export const WORKSPACE_COLLECTIONS = ["chats", "memories", "projects", "files", "usage", "audit", "agents", "deployments", "runs", "runEvents", "connections", "mailboxes", "schedules", "pins", "browserSessions"] as const;
export type WorkspaceCollection = typeof WORKSPACE_COLLECTIONS[number];
export type WorkspaceChanges = {
  version: 1;
  upserts: Partial<Record<WorkspaceCollection, { id: string; [key: string]: unknown }[]>>;
  deletes: Partial<Record<WorkspaceCollection, string[]>>;
  order?: Partial<Record<WorkspaceCollection, string[]>>;
  halted?: boolean;
  deletedChatIds?: string[];
  deletedMemoryIds?: string[];
};
export const MAX_WORKSPACE_CHANGE_CHARS = 1_500_000;

/** A save carries only resources changed since the caller's last acknowledged representation. */
export function planWorkspaceChanges(before: Workspace, after: Workspace): WorkspaceChanges {
  const upserts: WorkspaceChanges["upserts"] = {};
  const deletes: WorkspaceChanges["deletes"] = {};
  const order: NonNullable<WorkspaceChanges["order"]> = {};
  for (const key of WORKSPACE_COLLECTIONS) {
    const old = new Map(before[key].map((item) => [item.id, canonical(item)]));
    const next = new Set(after[key].map((item) => item.id));
    const changed = after[key].filter((item) => old.get(item.id) !== canonical(item));
    if (changed.length) upserts[key] = changed as { id: string; [key: string]: unknown }[];
    const removed = [...old.keys()].filter((id) => !next.has(id));
    if (removed.length) deletes[key] = removed;
    const ids = after[key].map((item) => item.id);
    if (canonical(before[key].map((item) => item.id)) !== canonical(ids)) order[key] = ids;
  }
  const previousChats = new Set(before.deletedChatIds ?? []);
  const previousMemories = new Set(before.deletedMemoryIds ?? []);
  const deletedChatIds = (after.deletedChatIds ?? []).filter((id) => !previousChats.has(id));
  const deletedMemoryIds = (after.deletedMemoryIds ?? []).filter((id) => !previousMemories.has(id));
  return { version: 1, upserts, deletes, ...(Object.keys(order).length ? { order } : {}), ...(before.halted !== after.halted ? { halted: after.halted } : {}), ...(deletedChatIds.length ? { deletedChatIds } : {}), ...(deletedMemoryIds.length ? { deletedMemoryIds } : {}) };
}

export function validateWorkspaceChanges(value: unknown): { ok: true; changes: WorkspaceChanges } | { ok: false; error: string } {
  const invalid = { ok: false as const, error: "Invalid workspace resource changes. Nothing was saved." };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  let size: number;
  try { size = JSON.stringify(value).length; } catch { return invalid; }
  if (size > MAX_WORKSPACE_CHANGE_CHARS) return { ok: false, error: "These changed resources exceed the per-save request limit. Save smaller groups or archive an oversized individual resource; existing server data was kept." };
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !row.upserts || typeof row.upserts !== "object" || Array.isArray(row.upserts) || !row.deletes || typeof row.deletes !== "object" || Array.isArray(row.deletes)) return invalid;
  if (Object.keys(row).some((key) => !["version", "upserts", "deletes", "order", "halted", "deletedChatIds", "deletedMemoryIds"].includes(key))) return invalid;
  if (row.halted !== undefined && typeof row.halted !== "boolean") return invalid;
  const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
  for (const [key, entries] of Object.entries(row.upserts)) {
    if (!(WORKSPACE_COLLECTIONS as readonly string[]).includes(key) || !Array.isArray(entries) || entries.length > 10000 || entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) || !validId(entry.id))) return invalid;
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return invalid;
  }
  for (const [key, ids] of Object.entries(row.deletes)) {
    if (!(WORKSPACE_COLLECTIONS as readonly string[]).includes(key) || !Array.isArray(ids) || ids.some((id) => !validId(id))) return invalid;
    const upserts = (row.upserts as Record<string, { id: string }[]>)[key];
    if (upserts && ids.some((id) => upserts.some((entry) => entry.id === id))) return invalid;
  }
  for (const key of ["deletedChatIds", "deletedMemoryIds"]) if (row[key] !== undefined && (!Array.isArray(row[key]) || (row[key] as unknown[]).some((id) => !validId(id)))) return invalid;
  if (row.order !== undefined) {
    if (!row.order || typeof row.order !== "object" || Array.isArray(row.order)) return invalid;
    for (const [key, ids] of Object.entries(row.order)) if (!(WORKSPACE_COLLECTIONS as readonly string[]).includes(key) || !Array.isArray(ids) || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length) return invalid;
  }
  return { ok: true, changes: value as WorkspaceChanges };
}

export function applyWorkspaceChanges(current: Workspace, changes: WorkspaceChanges): Workspace {
  const next: Record<string, unknown> = { ...current };
  for (const key of WORKSPACE_COLLECTIONS) {
    const incoming = new Map((changes.upserts[key] ?? []).map((item) => [item.id, item]));
    const removed = new Set(changes.deletes[key] ?? []);
    const kept = current[key].flatMap((item) => removed.has(item.id) ? [] : [incoming.get(item.id) ?? item]);
    const old = new Set(current[key].map((item) => item.id));
    const combined = [...kept, ...[...incoming.values()].filter((item) => !old.has(item.id) && !removed.has(item.id))];
    const order = changes.order?.[key];
    const positions = new Map((order ?? []).map((id, index) => [id, index]));
    next[key] = order ? combined.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)) : combined;
  }
  if (changes.halted !== undefined) next.halted = changes.halted;
  // Any explicit chat/memory removal creates a tombstone even if an old caller forgot it.
  next.deletedChatIds = [...new Set([...(current.deletedChatIds ?? []), ...(changes.deletedChatIds ?? []), ...(changes.deletes.chats ?? [])])];
  next.deletedMemoryIds = [...new Set([...(current.deletedMemoryIds ?? []), ...(changes.deletedMemoryIds ?? []), ...(changes.deletes.memories ?? [])])];
  return next as Workspace;
}
