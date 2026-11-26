import { useMemo } from "react";

/** This describes the serialized workspace record, excluding separately stored blobs. */
export function useWorkspaceRecordSize(workspace: unknown, view: string, settingsPane: string | null): number {
  return useMemo(() => view === "settings" && settingsPane === "data" ? new Blob([JSON.stringify(workspace)]).size : 0, [workspace, view, settingsPane]);
}
