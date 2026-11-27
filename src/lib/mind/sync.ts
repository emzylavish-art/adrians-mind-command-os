export type ServerSync = "use-server" | "upload-local" | "keep-local" | "empty";

export function chooseServerSync(localHasContent: boolean, serverHasContent: boolean): ServerSync {
  if (!localHasContent && serverHasContent) return "use-server";
  if (localHasContent && !serverHasContent) return "upload-local";
  if (localHasContent && serverHasContent) return "keep-local";
  return "empty";
}

import type { Workspace } from "./types.ts";
import { canonical, workspaceJsonValue, emptyWorkspace } from "./workspace.ts";
import { mergeWorkspaceEdits, workspaceCollections, reconcileWorkspace, type WorkspaceConflict } from "./workspace-edits.ts";


type LoadedCopy = { ok: true; workspace: Workspace | null; revision: string } | { ok: false; error: string };
type SavedCopy = { ok: true; revision: string } | { ok: false; error: string; conflict?: boolean };
export type ReconciledCopy =
  | { ok: true; workspace: Workspace; revision: string }
  | { ok: false; error: string; conflicts?: WorkspaceConflict[]; reviewRevision?: string };

/** Refresh, three-way compare, then CAS. A second conflict gets one fresh comparison;
 * there is never an unbounded retry or an unconditional full replacement. */
export async function synchronizeWorkspace(input: {
  local: Workspace;
  base: Workspace | null;
  load: () => Promise<LoadedCopy>;
  save: (workspace: Workspace, revision: string) => Promise<SavedCopy>;
  current: () => boolean;
  resolution?: { preference: "local" | "server"; revision: string };
}): Promise<ReconciledCopy> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await input.load();
    if (!input.current()) return { ok: false, error: "The account workspace changed during synchronization." };
    if (!remote.ok) return remote;
    const preference = input.resolution?.revision === remote.revision ? input.resolution.preference : undefined;
    const merged = reconcileWorkspace(remote.workspace ?? emptyWorkspace(), input.base ?? emptyWorkspace(), input.local, preference);
    if (merged.conflicts.length) return {
      ok: false, conflicts: merged.conflicts, reviewRevision: remote.revision,
      error: `${merged.conflicts.length} conflicting workspace edit(s) need a choice. Both copies were kept.`,
    };
    if (!input.current()) return { ok: false, error: "The account workspace changed before saving." };
    const saved = await input.save(merged.workspace, remote.revision);
    if (!input.current()) return { ok: false, error: "The account workspace changed during synchronization." };
    if (saved.ok) return { ok: true, workspace: merged.workspace, revision: saved.revision };
    if (!saved.conflict) return saved;
  }
  return { ok: false, error: "The server changed again during synchronization. Both copies were kept. Retry save to compare again." };
}

export function serverCheckpointKey(ownerId: string): string {
  return `amcos.sync-base.v1.${encodeURIComponent(ownerId)}`;
}

/** A common ancestor enables real three-way reconciliation. With no ancestor,
 * only independent additions merge; same-ID differences become review conflicts. */
export function reconcileServerWorkspace(local: Workspace, server: Workspace, base: Workspace | null): { workspace: Workspace; needsReview: boolean; changed: boolean } {
  if (canonical(local) === canonical(server)) return { workspace: local, needsReview: Boolean(local.syncConflicts?.length), changed: false };
  if (!base) {
    // Missing in one copy could mean deleted or newly created. Do not guess.
    const conflicts = [...(server.syncConflicts ?? []), ...(local.syncConflicts ?? [])];
    for (const collection of workspaceCollections) {
      const left = new Map(local[collection].map((row) => [row.id, row]));
      const right = new Map(server[collection].map((row) => [row.id, row]));
      for (const id of new Set([...left.keys(), ...right.keys()])) {
        if (canonical(left.get(id)) !== canonical(right.get(id))) conflicts.push({ id: `${collection}:${id}:record`, collection, recordId: id, field: "*", local: workspaceJsonValue(left.get(id)), remote: workspaceJsonValue(right.get(id)) });
      }
    }
    for (const field of ["halted", "toolPermissions"] as const) {
      if (canonical(local[field]) !== canonical(server[field])) conflicts.push({ id: `workspace:${field}`, collection: "workspace", recordId: "settings", field, local: workspaceJsonValue(local[field]), remote: workspaceJsonValue(server[field]) });
    }
    const unique = [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()];
    const deletedMemoryIds = [...new Set([...(local.deletedMemoryIds ?? []), ...(server.deletedMemoryIds ?? [])])];
    const workspace = { ...local, memories: local.memories.filter((memory) => !deletedMemoryIds.includes(memory.id)), ...(deletedMemoryIds.length ? { deletedMemoryIds } : {}), syncConflicts: unique };
    return { workspace, needsReview: unique.length > 0, changed: canonical(workspace) !== canonical(local) };
  }
  const workspace = mergeWorkspaceEdits(server, base, local);
  return { workspace, needsReview: Boolean(workspace.syncConflicts?.length), changed: canonical(workspace) !== canonical(local) };
}
