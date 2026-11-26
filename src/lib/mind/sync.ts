export type ServerSync = "use-server" | "upload-local" | "keep-local" | "empty";

export function chooseServerSync(localHasContent: boolean, serverHasContent: boolean): ServerSync {
  if (!localHasContent && serverHasContent) return "use-server";
  if (localHasContent && !serverHasContent) return "upload-local";
  if (localHasContent && serverHasContent) return "keep-local";
  return "empty";
}
import type { Workspace } from "./types.ts";
import { emptyWorkspace } from "./workspace.ts";
import { reconcileWorkspace, type WorkspaceConflict } from "./workspace-edits.ts";


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
