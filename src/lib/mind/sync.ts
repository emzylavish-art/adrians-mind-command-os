import type { Workspace } from "./types";

export type ServerSync = "use-server" | "upload-local" | "keep-local" | "empty";

export function chooseServerSync(localHasContent: boolean, serverHasContent: boolean): ServerSync {
  if (!localHasContent && serverHasContent) return "use-server";
  if (localHasContent && !serverHasContent) return "upload-local";
  if (localHasContent && serverHasContent) return "keep-local";
  return "empty";
}

function workspaceHasContent(ws: Workspace) {
  return ws.chats.length + ws.memories.length + ws.projects.length + ws.files.length + ws.audit.length > 0;
}

/** Prefer non-empty local cache; fall back to server seed for signed-in first paint. */
export function pickInitialWorkspace(local: Workspace, server: Workspace | null | undefined): Workspace {
  if (server && workspaceHasContent(server) && !workspaceHasContent(local)) return server;
  return local;
}
