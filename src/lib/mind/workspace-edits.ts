import type { Chat, Workspace } from "./types.ts";
import { canonical, mergeMemoryState } from "./workspace.ts";

function same(left: unknown, right: unknown): boolean {
  return left === right || canonical(left) === canonical(right);
}

function mergeRows<T extends { id: string }>(
  stored: T[],
  base: T[],
  edited: T[],
  reconcile: (current: T, before: T, after: T) => T = (_current, _before, after) => after,
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
    runs: mergeRows(stored.runs, base.runs, edited.runs),
    runEvents: mergeRows(stored.runEvents, base.runEvents, edited.runEvents),
    connections: mergeRows(stored.connections, base.connections, edited.connections),
    mailboxes: mergeRows(stored.mailboxes, base.mailboxes, edited.mailboxes),
    schedules: mergeRows(stored.schedules, base.schedules, edited.schedules),
    pins: mergeRows(stored.pins, base.pins, edited.pins),
    browserSessions: mergeRows(stored.browserSessions, base.browserSessions, edited.browserSessions),
  };
}
