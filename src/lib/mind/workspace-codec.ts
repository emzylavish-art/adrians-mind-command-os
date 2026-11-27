import { normalizeWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";

export type WorkspaceParseRequest = { id: string; raw: string };
export type WorkspaceParseResponse = { id: string; ok: true; workspace: Workspace } | { id: string; ok: false; error: string };

export function normalizeSerializedWorkspace(raw: string): Workspace {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("The saved workspace JSON could not be read. Its original bytes were kept; no empty copy was saved over it."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The saved workspace is not a supported object. Its original bytes were kept.");
  return normalizeWorkspace(parsed);
}

export function handleWorkspaceParse(request: WorkspaceParseRequest): WorkspaceParseResponse {
  try { return { id: request.id, ok: true, workspace: normalizeSerializedWorkspace(request.raw) }; }
  catch { return { id: request.id, ok: false, error: "The saved workspace could not be read. Its original bytes were kept; no empty copy was saved over it." }; }
}
