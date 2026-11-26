export type ServerSync = "use-server" | "upload-local" | "keep-local" | "empty";

export function chooseServerSync(localHasContent: boolean, serverHasContent: boolean): ServerSync {
  if (!localHasContent && serverHasContent) return "use-server";
  if (localHasContent && !serverHasContent) return "upload-local";
  if (localHasContent && serverHasContent) return "keep-local";
  return "empty";
}

import type { Workspace } from "./types.ts";
import { canonical, workspaceJsonValue } from "./workspace.ts";
import { mergeWorkspaceEdits, workspaceCollections } from "./workspace-edits.ts";

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
