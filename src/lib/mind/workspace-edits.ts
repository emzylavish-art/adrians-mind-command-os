import type { AgentRun, Chat, Workspace } from "./types.ts";
import { canonical, mergeMemoryState } from "./workspace.ts";

export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  return left === right || canonical(left) === canonical(right);
}
const same = sameWorkspaceValue;

/** Apply changed fields only; editing instructions must not undo a concurrent rename. */
function mergeFields<T extends { id: string }>(current: T, before: T, after: T): T {
  const change = Object.fromEntries(Object.keys({ ...before, ...after })
    .filter((key) => !same(before[key as keyof T], after[key as keyof T]))
    .map((key) => [key, after[key as keyof T]]));
  return { ...current, ...change };
}

function mergeRows<T extends { id: string }>(
  stored: T[],
  base: T[],
  edited: T[],
  reconcile: (current: T, before: T, after: T) => T = mergeFields,
): T[] {
  if (same(base, stored)) return edited;
  if (same(base, edited)) return stored;
  const before = new Map(base.map((row) => [row.id, row]));
  const after = new Map(edited.map((row) => [row.id, row]));
  const result: T[] = [];
  for (const current of stored) {
    const previous = before.get(current.id);
    const next = after.get(current.id);
    if (!previous || (next && same(previous, next))) result.push(current);
    else if (next) result.push(reconcile(current, previous, next));
    after.delete(current.id);
  }
  // A stale edit must not recreate a record that another tab removed.
  for (const [id, row] of after) if (!before.has(id)) result.push(row);
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

function mergeChat(stored: Chat, base: Chat, edited: Chat): Chat {
  const change = Object.fromEntries(
    (Object.keys({ ...base, ...edited }) as (keyof Chat)[])
      .filter((key) => key !== "messages" && !same(base[key], edited[key]))
      .map((key) => [key, edited[key]]),
  );
  return { ...stored, ...change, messages: mergeRows(stored.messages, base.messages, edited.messages) };
}

/** Apply only the changes this browser made from its last locally persisted checkpoint. */
export function mergeWorkspaceEdits(stored: Workspace, base: Workspace, edited: Workspace): Workspace {
  return {
    ...stored,
    ...mergeMemoryState(stored, edited),
    halted: edited.halted === base.halted ? stored.halted : edited.halted,
    chats: mergeRows(stored.chats, base.chats, edited.chats, mergeChat),
    projects: mergeRows(stored.projects, base.projects, edited.projects),
    files: mergeRows(stored.files, base.files, edited.files),
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
