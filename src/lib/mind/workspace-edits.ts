import type { Chat, Workspace, WorkspaceConflict } from "./types.ts";
import { canonical, mergeMemoryState, workspaceJsonValue } from "./workspace.ts";

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

/** Apply changes against their common checkpoint and retain genuine conflicts. */
export function mergeWorkspaceEdits(stored: Workspace, base: Workspace, edited: Workspace): Workspace {
  const conflicts = pendingConflicts(stored, base, edited);
  const mergeChat = (current: Chat, before: Chat, after: Chat): Chat => {
    const { messages: _a, ...a } = current, { messages: _b, ...b } = before, { messages: _c, ...c } = after;
    return { ...mergeFields(a, b, c, "chats", conflicts), messages: mergeRows(current.messages, before.messages, after.messages, `messages/${current.id}`, conflicts) };
  };
  const next: Workspace = {
    ...stored,
    ...mergeMemoryState(stored, edited),
    halted: edited.halted === base.halted ? stored.halted : edited.halted,
    chats: mergeRows(stored.chats, base.chats, edited.chats, "chats", conflicts, mergeChat),
    projects: mergeRows(stored.projects, base.projects, edited.projects, "projects", conflicts),
    files: mergeRows(stored.files, base.files, edited.files, "files", conflicts),
    usage: mergeRows(stored.usage, base.usage, edited.usage, "usage", conflicts).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    audit: mergeRows(stored.audit, base.audit, edited.audit, "audit", conflicts).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    agents: mergeRows(stored.agents, base.agents, edited.agents, "agents", conflicts),
    deployments: mergeRows(stored.deployments, base.deployments, edited.deployments, "deployments", conflicts),
    runs: mergeRows(stored.runs, base.runs, edited.runs, "runs", conflicts),
    runEvents: mergeRows(stored.runEvents, base.runEvents, edited.runEvents, "runEvents", conflicts),
    connections: mergeRows(stored.connections, base.connections, edited.connections, "connections", conflicts),
    mailboxes: mergeRows(stored.mailboxes, base.mailboxes, edited.mailboxes, "mailboxes", conflicts),
    schedules: mergeRows(stored.schedules, base.schedules, edited.schedules, "schedules", conflicts),
    pins: mergeRows(stored.pins, base.pins, edited.pins, "pins", conflicts),
    browserSessions: mergeRows(stored.browserSessions, base.browserSessions, edited.browserSessions, "browserSessions", conflicts),
  };
  const unique = [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()];
  if (stored.toolPermissions || edited.toolPermissions) {
    next.toolPermissions = { ...stored.toolPermissions };
    for (const key of ["list_projects", "list_chats", "search_notes"]) {
      const local = edited.toolPermissions?.[key], old = base.toolPermissions?.[key], remote = stored.toolPermissions?.[key];
      if (local !== old && local !== undefined) next.toolPermissions[key] = remote !== old && remote !== local ? false : local;
    }
  }
  if (unique.length) next.syncConflicts = unique;
  else delete next.syncConflicts;
  return next;
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
