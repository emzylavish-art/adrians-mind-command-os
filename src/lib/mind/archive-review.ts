import type { MemoryItem, Workspace } from "./types.ts";
import { canonical, emptyWorkspace, normalizeWorkspace, sha256 } from "./workspace.ts";

export function unreviewedMemoryScopeIds(notes: unknown): Set<string> {
  if (!Array.isArray(notes)) return new Set();
  return new Set(notes.filter(note => note && typeof note.id === "string" && !["global", "project", "chat"].includes(note.scope)).map(note => note.id));
}

export function archiveReview(current: Workspace, incoming: Workspace) {
  const conflicts: { category: string; id: string }[] = [];
  for (const category of ["projects", "files", "agents", "schedules", "connections", "mailboxes", "deployments", "runs", "browserSessions"] as const) {
    const local = new Map(current[category].map(row => [row.id, row]));
    for (const row of incoming[category]) {
      if (local.has(row.id) && canonical(local.get(row.id)) !== canonical(row)) conflicts.push({ category, id: row.id });
    }
  }
  const privacy = incoming.chats.filter(chat => chat.memory === "on" && current.chats.find(row => row.id === chat.id)?.memory !== "on").map(chat => ({ id: chat.id, title: chat.title }));
  return { conflicts, privacy, unresolved: incoming.memories.filter(note => note.reviewReason).map(note => ({ id: note.id, reason: note.reviewReason! })) };
}

/** Import boundaries never widen a missing association into global retrieval. */
export function quarantineImportedMemory(incoming: Workspace, destination: Workspace, missingScopeIds: Set<string> = new Set()): Workspace {
  const projectIds = new Set([...destination.projects, ...incoming.projects].map(row => row.id));
  const chatIds = new Set([...destination.chats, ...incoming.chats].map(row => row.id));
  // Imported transcripts can describe a completed workflow, but they cannot attest to a local run.
  const chats = incoming.chats.map(chat => ({
    ...chat, messages: chat.messages.map(message => {
      if (!message.workflowKind) return message;
      const { workflowKind: _imported, ...rest } = message;
      return rest;
    }),
  }));
  return { ...incoming, chats, memories: incoming.memories.map(note => {
    const reason = note.reviewReason || (missingScopeIds.has(note.id) ? "The archive did not declare this note's scope. Choose its scope before using it."
      : note.scope === "project" && !projectIds.has(note.projectId ?? "") ? "The referenced project is missing. Choose an existing project."
      : note.scope === "chat" && !chatIds.has(note.chatId ?? "") ? "The referenced conversation is missing. Choose an existing conversation." : null);
    return reason ? { ...note, archived: true, reviewReason: reason } : note;
  }) };
}

export function resolveImportedMemory(workspace: Workspace, id: string, scope: MemoryItem["scope"], destinationId: string | null): Workspace {
  if (!["global", "project", "chat"].includes(scope)) return workspace;
  if (scope === "project" && !workspace.projects.some(row => row.id === destinationId)) return workspace;
  if (scope === "chat" && !workspace.chats.some(row => row.id === destinationId)) return workspace;
  return { ...workspace, memories: workspace.memories.map(note => {
    if (note.id !== id) return note;
    const { reviewReason: _reason, ...rest } = note;
    return { ...rest, scope, projectId: scope === "project" ? destinationId : null, chatId: scope === "chat" ? destinationId : null, archived: false, updatedAt: new Date().toISOString() };
  }) };
}

export async function packMemoryOnly(workspace: Workspace) {
  const data = {
    memories: workspace.memories,
    scopes: {
      projects: workspace.projects.filter(row => workspace.memories.some(note => note.projectId === row.id)).map(({ id, name }) => ({ id, name })),
      chats: workspace.chats.filter(row => workspace.memories.some(note => note.chatId === row.id)).map(({ id, title }) => ({ id, title })),
    },
  };
  return { product: "adrians-mind-memory", format: 1, data, sha256: await sha256(canonical(data)) };
}

export async function unpackMemoryOnly(raw: string, destination: Workspace): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: string }> {
  try {
    const archive = JSON.parse(raw);
    if (archive.product !== "adrians-mind-memory" || archive.format !== 1 || !Array.isArray(archive.data?.memories)) return { ok: false, error: "This is not a memory-only archive." };
    if (typeof archive.sha256 !== "string" || await sha256(canonical(archive.data)) !== archive.sha256) return { ok: false, error: "Memory archive hash does not match. Nothing was imported." };
    const missing = unreviewedMemoryScopeIds(archive.data.memories);
    const workspace = normalizeWorkspace({ ...emptyWorkspace(), memories: archive.data.memories });
    return { ok: true, workspace: quarantineImportedMemory(workspace, destination, missing) };
  } catch { return { ok: false, error: "That memory archive could not be read." }; }
}
