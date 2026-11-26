import type { Chat, Workspace, WorkspaceConflict, AgentRun } from "./types.ts";
import { canonical, mergeChatDeletionState, mergeMemoryState, workspaceJsonValue } from "./workspace.ts";

export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  return left === right || canonical(left) === canonical(right);
}
const same = sameWorkspaceValue;
type Row = { id: string };
const safeFields: Partial<Record<keyof Workspace, Set<string>>> = {
  projects: new Set(["name", "description"]),
  files: new Set(["name", "projectId"]),
};

function mergeFields<T extends Row>(stored: T, base: T, edited: T, collection: string, conflicts: WorkspaceConflict[], fields?: Set<string>): T {
  const result: Record<string, unknown> = { ...stored };
  const old = base as T & Record<string, unknown>, local = edited as T & Record<string, unknown>, remote = stored as T & Record<string, unknown>;
  const changed = Object.keys({ ...old, ...local }).filter((key) => key !== "id" && !same(old[key], local[key]));
  const remoteChanged = Object.keys({ ...old, ...remote }).filter((key) => key !== "id" && !same(old[key], remote[key]));
  // Security-sensitive records are coherent units: never synthesize unreviewed permissions.
  if (fields && changed.some((key) => !fields.has(key)) && remoteChanged.length && !same(stored, edited)) {
    conflicts.push({ id: `${collection}:${stored.id}:record`, collection, recordId: stored.id, field: "*", local: workspaceJsonValue(edited), remote: workspaceJsonValue(stored) });
    return stored;
  }
  for (const key of changed) {
    if (!same(old[key], remote[key]) && !same(local[key], remote[key])) {
      conflicts.push({ id: `${collection}:${stored.id}:${key}`, collection, recordId: stored.id, field: key, local: workspaceJsonValue(local[key]), remote: workspaceJsonValue(remote[key]) });
    } else result[key] = local[key];
  }
  return result as T;
}

function mergeRows<T extends Row>(stored: T[], base: T[], edited: T[], collection: string, conflicts: WorkspaceConflict[], reconcile?: (current: T, before: T, after: T) => T): T[] {
  if (same(base, stored)) return edited;
  if (same(base, edited)) return stored;
  const before = new Map(base.map((row) => [row.id, row]));
  const after = new Map(edited.map((row) => [row.id, row]));
  const result: T[] = [];
  for (const current of stored) {
    const previous = before.get(current.id), next = after.get(current.id);
    if (!previous) {
      result.push(current);
      if (next && !same(current, next)) conflicts.push({ id: `${collection}:${current.id}:record`, collection, recordId: current.id, field: "*", local: workspaceJsonValue(next), remote: workspaceJsonValue(current) });
    } else if (next && same(previous, next)) result.push(current);
    else if (next) result.push(reconcile ? reconcile(current, previous, next) : mergeFields(current, previous, next, collection, conflicts, safeFields[collection as keyof Workspace] ?? new Set()));
    else if (!same(previous, current)) {
      result.push(current);
      conflicts.push({ id: `${collection}:${current.id}:delete`, collection, recordId: current.id, field: "*", local: null, remote: workspaceJsonValue(current) });
    }
    after.delete(current.id);
  }
  for (const [id, row] of after) {
    if (!before.has(id)) result.push(row);
    else if (!same(before.get(id), row)) {
      // Deletion wins immediately; the competing edit remains available for explicit review.
      conflicts.push({ id: `${collection}:${id}:delete`, collection, recordId: id, field: "*", local: workspaceJsonValue(row), remote: null });
    }
  }
  return result;
}

export type WorkspaceConflict = { collection: string; id: string; field: string };

/** No field is silently selected during server reconciliation. A returned candidate is
 * safe to publish only when conflicts is empty, or after an explicit resolution. */
export function reconcileWorkspace(
  remote: Workspace,
  base: Workspace,
  local: Workspace,
  preference?: "local" | "server",
): { workspace: Workspace; conflicts: WorkspaceConflict[] } {
  const conflicts: WorkspaceConflict[] = [];
  const inspectRows = (collection: string, stored: { id: string }[], before: { id: string }[], edited: { id: string }[]) => {
    const prior = new Map(before.map((row) => [row.id, row]));
    const incoming = new Map(stored.map((row) => [row.id, row]));
    const changed = new Map(edited.map((row) => [row.id, row]));
    for (const id of new Set([...prior.keys(), ...incoming.keys(), ...changed.keys()])) {
      const old = prior.get(id) as Record<string, unknown> | undefined;
      const other = incoming.get(id) as Record<string, unknown> | undefined;
      const next = changed.get(id) as Record<string, unknown> | undefined;
      if (same(old, next) || same(old, other) || same(other, next)) continue;
      if (!other || !next) {
        // A deletion wins during ordinary tab merging, but a concurrent edit is
        // held for review before publishing to a different device.
        conflicts.push({ collection, id, field: "record deletion" });
        continue;
      }
      for (const field of Object.keys({ ...old, ...other, ...next })) {
        if (field === "messages" && collection === "chats") {
          inspectRows(`chats/${id}/messages`, (other.messages ?? []) as { id: string }[], (old?.messages ?? []) as { id: string }[], (next.messages ?? []) as { id: string }[]);
        } else if (!same(old?.[field], next[field]) && !same(old?.[field], other[field]) && !same(other[field], next[field])) {
          conflicts.push({ collection, id, field });
        }
      }
    }
  };
  for (const key of ["chats", "projects", "files", "agents", "deployments", "runs", "runEvents", "connections", "mailboxes", "schedules", "pins", "browserSessions"] as const) {
    inspectRows(key, remote[key], base[key], local[key]);
  }
  let workspace = preference === "server"
    ? mergeWorkspaceEdits(local, base, remote)
    : mergeWorkspaceEdits(remote, base, local);
  if (preference) {
    const chosen = preference === "local" ? local : remote;
    const resolve = (rows: { id: string }[], selected: { id: string }[], conflict: WorkspaceConflict) => {
      const row = selected.find((item) => item.id === conflict.id);
      if (!row) return rows.filter((item) => item.id !== conflict.id);
      const existing = rows.find((item) => item.id === conflict.id);
      if (!existing) return [...rows, row];
      return rows.map((item) => item.id !== conflict.id ? item : conflict.field === "record deletion" ? row
        : { ...item, [conflict.field]: (row as Record<string, unknown>)[conflict.field] });
    };
    for (const conflict of conflicts) {
      if (conflict.collection.startsWith("chats/")) {
        const chatId = conflict.collection.split("/")[1];
        workspace = { ...workspace, chats: workspace.chats.map((chat) => chat.id === chatId
          ? { ...chat, messages: resolve(chat.messages, chosen.chats.find((item) => item.id === chatId)?.messages ?? [], conflict) as Chat["messages"] }
          : chat) };
      } else {
        const key = conflict.collection as Exclude<keyof Workspace, "version" | "halted" | "deletedMemoryIds">;
        workspace = { ...workspace, [key]: resolve(workspace[key], chosen[key], conflict) };
      }
    }
  }
  return { workspace, conflicts: preference ? [] : conflicts };
}

function mergeRun(current: AgentRun, before: AgentRun, after: AgentRun): AgentRun {
  const merged = mergeFields(current, before, after);
  if (["completed", "failed", "canceled"].includes(current.state) && current.state !== before.state) {
    // A stale worker checkpoint cannot restart a terminal execution or replace
    // its final receipt. A new attempt has a new run ID.
    return { ...merged, state: current.state, result: current.result, error: current.error,
      step: current.step, workerId: current.workerId, leaseUntil: current.leaseUntil, updatedAt: current.updatedAt };
  }
  return merged;
}

export const workspaceCollections = ["chats", "memories", "projects", "files", "usage", "audit", "agents", "deployments", "runs", "runEvents", "connections", "mailboxes", "schedules", "pins", "browserSessions"] as const;

function pendingConflicts(stored: Workspace, base: Workspace, edited: Workspace): WorkspaceConflict[] {
  const before = new Map((base.syncConflicts ?? []).map((item) => [item.id, item]));
  const after = new Map((edited.syncConflicts ?? []).map((item) => [item.id, item]));
  const result: WorkspaceConflict[] = [];
  for (const current of stored.syncConflicts ?? []) {
    const previous = before.get(current.id), next = after.get(current.id);
    // An explicit resolution removes precisely the reviewed variant, while a
    // newer conflict from another device must remain reviewable.
    if (!previous || next || !same(current, previous)) result.push(next && same(current, previous) ? next : current);
    after.delete(current.id);
  }
  for (const [id, next] of after) {
    if (!before.has(id) || !same(before.get(id), next)) result.push(next);
  }
  return result;
}

/** Apply only the changes this browser made from its last locally persisted checkpoint. */
export function mergeWorkspaceEdits(stored: Workspace, base: Workspace, edited: Workspace): Workspace {
  const deletedFiles = [...new Set([...(stored.deletedFileIds ?? []), ...(edited.deletedFileIds ?? [])])];
  return {
    ...stored,
    ...(stored.recovery?.length || edited.recovery?.length ? { recovery: mergeRows(stored.recovery ?? [], base.recovery ?? [], edited.recovery ?? []).slice(0, 200) } : {}),
    ...mergeMemoryState(stored, edited),
    halted: edited.halted === base.halted ? stored.halted : edited.halted,
    ...mergeChatDeletionState({ ...edited, chats: mergeRows(stored.chats, base.chats, edited.chats, mergeChat) }, stored),
    projects: mergeRows(stored.projects, base.projects, edited.projects),
    files: mergeRows(stored.files, base.files, edited.files).filter((file) => !deletedFiles.includes(file.id)),
    ...(deletedFiles.length ? { deletedFileIds: deletedFiles } : {}),
    usage: [...mergeRows(stored.usage, base.usage, edited.usage)].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    audit: [...mergeRows(stored.audit, base.audit, edited.audit)].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    agents: mergeRows(stored.agents, base.agents, edited.agents),
    deployments: mergeRows(stored.deployments, base.deployments, edited.deployments),
    runs: mergeRows(stored.runs, base.runs, edited.runs, mergeRun),
    runEvents: mergeRows(stored.runEvents, base.runEvents, edited.runEvents),
    connections: mergeRows(stored.connections, base.connections, edited.connections),
    mailboxes: mergeRows(stored.mailboxes, base.mailboxes, edited.mailboxes),
    schedules: mergeRows(stored.schedules, base.schedules, edited.schedules),
    pins: mergeRows(stored.pins, base.pins, edited.pins),
    browserSessions: mergeRows(stored.browserSessions, base.browserSessions, edited.browserSessions),
  };
}

/** Explicit review is the only operation that selects a conflicting variant. */
export function resolveWorkspaceConflict(workspace: Workspace, id: string, choice: "local" | "remote"): Workspace {
  const conflict = workspace.syncConflicts?.find((item) => item.id === id);
  if (!conflict) return workspace;
  const value = conflict[choice];
  const changeRows = <T extends Row>(rows: T[]): T[] => {
    if (conflict.field === "*") return value === null ? rows.filter((row) => row.id !== conflict.recordId)
      : [...rows.filter((row) => row.id !== conflict.recordId), value as T];
    return rows.map((row) => row.id === conflict.recordId ? { ...row, [conflict.field]: value } : row);
  };
  let next = { ...workspace, syncConflicts: workspace.syncConflicts!.filter((item) => item.id !== id) };
  if (conflict.collection === "workspace" && conflict.field === "toolPermissions") {
    const permissions = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    next = { ...next, toolPermissions: Object.fromEntries(["list_projects", "list_chats", "search_notes"].filter((key) => typeof permissions[key] === "boolean").map((key) => [key, permissions[key] as boolean])) };
  } else if (conflict.collection === "workspace" && conflict.field === "halted") {
    next = { ...next, halted: value === true };
  } else if (conflict.collection.startsWith("messages/")) {
    const chatId = conflict.collection.slice("messages/".length);
    next = { ...next, chats: next.chats.map((chat) => chat.id === chatId ? { ...chat, messages: changeRows(chat.messages) } : chat) };
  } else if (workspaceCollections.includes(conflict.collection as typeof workspaceCollections[number])) {
    const key = conflict.collection as typeof workspaceCollections[number];
    next = { ...next, [key]: changeRows(next[key] as Row[]) };
  }
  return next;
}
