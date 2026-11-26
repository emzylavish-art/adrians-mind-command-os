import type { Chat, Workspace } from "./types.ts";
import { canonical, normalizeWorkspace } from "./workspace.ts";
import { workspaceCollections } from "./workspace-edits.ts";

type Row = { id: string };
export type CollectionDelta = { upsert: Row[]; remove: string[]; order?: string[] };
export type WorkspaceDelta = {
  version: 1;
  collections: Partial<Record<typeof workspaceCollections[number], CollectionDelta>>;
  chatMetadata?: Omit<Chat, "messages">[];
  chatMessages?: Record<string, CollectionDelta>;
  halted?: boolean;
  deletedMemoryIds?: string[];
  syncConflicts?: Workspace["syncConflicts"];
  toolPermissions?: Workspace["toolPermissions"];
};
export const MAX_WORKSPACE_DELTA_BYTES = 1_500_000;
export const workspaceJsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Transmit changed records only; the compatibility checkpoint remains available to older clients. */
export function createWorkspaceDelta(base: Workspace, next: Workspace): WorkspaceDelta {
  const delta: WorkspaceDelta = { version: 1, collections: {} };
  for (const key of workspaceCollections) {
    if (base[key] === next[key]) continue;
    const previous = new Map((base[key] as Row[]).map((row) => [row.id, row]));
    const current = next[key] as Row[];
    const ids = new Set(current.map((row) => row.id));
    if (key === "chats") {
      for (const chat of next.chats) {
        const prior = base.chats.find((item) => item.id === chat.id);
        const { messages, ...metadata } = chat;
        const { messages: _messages, ...priorMetadata } = prior ?? { messages: [] };
        if (canonical(metadata) !== canonical(priorMetadata)) (delta.chatMetadata ??= []).push(metadata);
        const before = new Map((prior?.messages ?? []).map((message) => [message.id, message]));
        const after = new Set(messages.map((message) => message.id));
        const upsert = messages.filter((message) => canonical(message) !== canonical(before.get(message.id)));
        const remove = [...before.keys()].filter((id) => !after.has(id));
        const ordered = messages.map((message) => message.id);
        const orderChanged = canonical([...before.keys()]) !== canonical(ordered);
        if (upsert.length || remove.length || orderChanged) (delta.chatMessages ??= {})[chat.id] = { upsert, remove, ...(orderChanged ? { order: ordered } : {}) };
      }
      const remove = [...previous.keys()].filter((id) => !ids.has(id));
      const order = current.map((row) => row.id);
      if (remove.length || canonical([...previous.keys()]) !== canonical(order)) delta.collections.chats = { upsert: [], remove, order };
      continue;
    }
    const upsert = current.filter((row) => canonical(row) !== canonical(previous.get(row.id)));
    const remove = [...previous.keys()].filter((id) => !ids.has(id));
    const orderChanged = canonical([...previous.keys()]) !== canonical(current.map((row) => row.id));
    if (upsert.length || remove.length || orderChanged) delta.collections[key] = { upsert, remove, ...(orderChanged ? { order: current.map((row) => row.id) } : {}) };
  }
  if (base.halted !== next.halted) delta.halted = next.halted;
  if (canonical(base.deletedMemoryIds ?? []) !== canonical(next.deletedMemoryIds ?? [])) delta.deletedMemoryIds = next.deletedMemoryIds ?? [];
  if (canonical(base.syncConflicts ?? []) !== canonical(next.syncConflicts ?? [])) delta.syncConflicts = next.syncConflicts ?? [];
  if (canonical(base.toolPermissions ?? {}) !== canonical(next.toolPermissions ?? {})) delta.toolPermissions = next.toolPermissions ?? {};
  return delta;
}

export function applyWorkspaceDelta(base: Workspace, raw: unknown): Workspace {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid workspace changes.");
  const delta = raw as WorkspaceDelta;
  if (delta.version !== 1 || !delta.collections || typeof delta.collections !== "object" || Array.isArray(delta.collections)) throw new Error("Invalid workspace changes.");
  if (workspaceJsonBytes(delta) > MAX_WORKSPACE_DELTA_BYTES) throw new Error("This change is too large to synchronize in one request. The browser copy was kept.");
  const next = { ...base };
  for (const [key, change] of Object.entries(delta.collections)) {
    if (!workspaceCollections.includes(key as typeof workspaceCollections[number]) || !change || !Array.isArray(change.upsert) || !Array.isArray(change.remove)) throw new Error("Invalid workspace collection.");
    if (change.upsert.some((row) => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id) || change.remove.some((id) => typeof id !== "string")) throw new Error("Invalid workspace record.");
    const collection = key as typeof workspaceCollections[number];
    const rows = new Map((base[collection] as Row[]).map((row) => [row.id, row]));
    for (const id of change.remove) rows.delete(id);
    for (const row of change.upsert) rows.set(row.id, row);
    Object.assign(next, { [collection]: [...rows.values()] });
  }
  if (delta.chatMetadata !== undefined) {
    if (!Array.isArray(delta.chatMetadata)) throw new Error("Invalid conversation changes.");
    for (const metadata of delta.chatMetadata) {
      if (!metadata || typeof metadata !== "object" || typeof metadata.id !== "string" || !metadata.id || "messages" in metadata) throw new Error("Invalid conversation metadata.");
      const prior = next.chats.find((chat) => chat.id === metadata.id);
      const chat = { ...metadata, messages: prior?.messages ?? [] };
      next.chats = prior ? next.chats.map((item) => item.id === chat.id ? chat : item) : [...next.chats, chat];
    }
  }
  if (delta.chatMessages !== undefined) {
    if (!delta.chatMessages || typeof delta.chatMessages !== "object" || Array.isArray(delta.chatMessages)) throw new Error("Invalid conversation messages.");
    for (const [id, change] of Object.entries(delta.chatMessages)) {
      const chat = next.chats.find((item) => item.id === id);
      if (!chat || !change || !Array.isArray(change.upsert) || !Array.isArray(change.remove) || change.upsert.some((row) => !row || typeof row.id !== "string") || change.remove.some((value) => typeof value !== "string")) throw new Error("Invalid conversation message changes.");
      const messages = new Map(chat.messages.map((message) => [message.id, message]));
      for (const removed of change.remove) messages.delete(removed);
      for (const row of change.upsert) messages.set(row.id, row as Chat["messages"][number]);
      const ordered = orderRows([...messages.values()], change.order);
      next.chats = next.chats.map((item) => item.id === id ? { ...item, messages: ordered } : item);
    }
  }
  for (const [key, change] of Object.entries(delta.collections)) {
    const collection = key as typeof workspaceCollections[number];
    Object.assign(next, { [collection]: orderRows(next[collection] as Row[], change!.order) });
  }
  if (delta.halted !== undefined) {
    if (typeof delta.halted !== "boolean") throw new Error("Invalid workspace stop state.");
    next.halted = delta.halted;
  }
  if (delta.deletedMemoryIds !== undefined) {
    if (!Array.isArray(delta.deletedMemoryIds) || delta.deletedMemoryIds.some((id) => typeof id !== "string")) throw new Error("Invalid memory deletion records.");
    next.deletedMemoryIds = [...new Set([...(base.deletedMemoryIds ?? []), ...delta.deletedMemoryIds])];
  }
  if (delta.syncConflicts !== undefined) next.syncConflicts = delta.syncConflicts;
  if (delta.toolPermissions !== undefined) next.toolPermissions = delta.toolPermissions;
  return normalizeWorkspace(next);
}

export function deltaIsEmpty(delta: WorkspaceDelta): boolean {
  return !Object.keys(delta.collections).length && !delta.chatMetadata?.length && !Object.keys(delta.chatMessages ?? {}).length && delta.halted === undefined && delta.deletedMemoryIds === undefined && delta.syncConflicts === undefined && delta.toolPermissions === undefined;
}

function orderRows<T extends Row>(rows: T[], order?: string[]): T[] {
  if (order === undefined) return rows;
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) throw new Error("Invalid record order.");
  const positions = new Map(order.map((id, index) => [id, index]));
  return rows.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/** Each batch is revision-checked and committed separately. A retry continues from
 * the last confirmed checkpoint; large workspaces do not need one huge request. */
export function splitWorkspaceDelta(delta: WorkspaceDelta, limit = MAX_WORKSPACE_DELTA_BYTES): WorkspaceDelta[] {
  if (workspaceJsonBytes(delta) <= limit) return deltaIsEmpty(delta) ? [] : [delta];
  const batches: WorkspaceDelta[] = [];
  let batch: WorkspaceDelta = { version: 1, collections: {} };
  let byteBound = 0;
  const append = (unit: WorkspaceDelta) => {
    const unitBytes = workspaceJsonBytes(unit);
    if (unitBytes > limit) throw new Error("One record exceeds the synchronization request limit. Export the workspace before reducing that record; the browser copy was kept.");
    // The sum includes repeated envelopes, so it safely overestimates merged
    // size without serializing a growing megabyte-sized batch for every row.
    if (byteBound + unitBytes > limit) {
      if (!deltaIsEmpty(batch)) batches.push(batch);
      batch = unit;
      byteBound = unitBytes;
      return;
    }
    const merged: WorkspaceDelta = { ...batch, ...unit, collections: { ...batch.collections } };
    for (const [key, change] of Object.entries(unit.collections)) {
      const collection = key as typeof workspaceCollections[number];
      const old = batch.collections[collection];
      merged.collections[collection] = { upsert: [...(old?.upsert ?? []), ...change!.upsert], remove: [...(old?.remove ?? []), ...change!.remove], ...(old?.order ? { order: old.order } : {}), ...(change!.order ? { order: change!.order } : {}) };
    }
    if (unit.chatMetadata) merged.chatMetadata = [...(batch.chatMetadata ?? []), ...unit.chatMetadata];
    if (unit.deletedMemoryIds) merged.deletedMemoryIds = [...(batch.deletedMemoryIds ?? []), ...unit.deletedMemoryIds];
    if (unit.chatMessages) {
      merged.chatMessages = { ...batch.chatMessages };
      for (const [id, change] of Object.entries(unit.chatMessages)) {
        const old = batch.chatMessages?.[id];
        merged.chatMessages[id] = { upsert: [...(old?.upsert ?? []), ...change.upsert], remove: [...(old?.remove ?? []), ...change.remove], ...(old?.order ? { order: old.order } : {}), ...(change.order ? { order: change.order } : {}) };
      }
    }
    batch = merged;
    byteBound += unitBytes;
  };
  // Revocations and conversation policy metadata reach the server first.
  for (const key of ["halted", "toolPermissions"] as const) if (delta[key] !== undefined) append({ version: 1, collections: {}, [key]: delta[key] });
  for (const id of delta.deletedMemoryIds ?? []) append({ version: 1, collections: {}, deletedMemoryIds: [id] });
  for (const metadata of delta.chatMetadata ?? []) append({ version: 1, collections: {}, chatMetadata: [metadata] });
  for (const [key, change] of Object.entries(delta.collections)) {
    for (const row of change!.upsert) append({ version: 1, collections: { [key]: { upsert: [row], remove: [] } } });
    for (const id of change!.remove) append({ version: 1, collections: { [key]: { upsert: [], remove: [id] } } });
  }
  for (const [id, change] of Object.entries(delta.chatMessages ?? {})) {
    for (const row of change.upsert) append({ version: 1, collections: {}, chatMessages: { [id]: { upsert: [row], remove: [] } } });
    for (const removed of change.remove) append({ version: 1, collections: {}, chatMessages: { [id]: { upsert: [], remove: [removed] } } });
    if (change.order) append({ version: 1, collections: {}, chatMessages: { [id]: { upsert: [], remove: [], order: change.order } } });
  }
  for (const [key, change] of Object.entries(delta.collections)) if (change!.order) append({ version: 1, collections: { [key]: { upsert: [], remove: [], order: change!.order } } });
  if (delta.syncConflicts !== undefined) append({ version: 1, collections: {}, syncConflicts: delta.syncConflicts });
  if (!deltaIsEmpty(batch)) batches.push(batch);
  return batches;
}
