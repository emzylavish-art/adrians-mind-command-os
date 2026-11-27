import type { MemoryItem, Workspace } from "../types.ts";

type Metadata = Pick<MemoryItem, "authority" | "tags" | "reviewAt" | "supersedesIds" | "sourceRef">;
const strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).map((part) => part.trim().slice(0, 200)))].slice(0, 40) : [];
export function normalizeMemoryMetadata(input: unknown): Metadata {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const authority = ["owner-approved", "unreviewed", "historical"].includes(String(row.authority)) ? row.authority as MemoryItem["authority"] : undefined;
  const source = row.sourceRef && typeof row.sourceRef === "object" ? row.sourceRef as Record<string, unknown> : {};
  const url = typeof source.url === "string" && /^https?:\/\//i.test(source.url) ? source.url.slice(0, 2000) : undefined;
  const sourceRef = Object.fromEntries(Object.entries({ documentId: typeof source.documentId === "string" ? source.documentId.slice(0, 200) : undefined, section: typeof source.section === "string" ? source.section.slice(0, 200) : undefined, quote: typeof source.quote === "string" ? source.quote.slice(0, 2000) : undefined, url }).filter(([, value]) => value !== undefined));
  return { ...(authority ? { authority } : {}), ...(strings(row.tags).length ? { tags: strings(row.tags) } : {}), ...(strings(row.supersedesIds).length ? { supersedesIds: strings(row.supersedesIds) } : {}), ...(typeof row.reviewAt === "string" && Number.isFinite(Date.parse(row.reviewAt)) ? { reviewAt: row.reviewAt.slice(0, 40) } : {}), ...(Object.keys(sourceRef).length ? { sourceRef } : {}) };
}

export function memoryMaintenance(items: MemoryItem[], now = Date.now()) {
  const groups = new Map<string, string[]>();
  for (const note of items.filter((item) => !item.archived)) {
    const content = note.text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const key = `${note.scope}:${note.projectId ?? ""}:${note.chatId ?? ""}:${content}`;
    groups.set(key, [...(groups.get(key) ?? []), note.id]);
  }
  const current = new Set(items.map((item) => item.id));
  return { duplicates: [...groups.values()].filter((group) => group.length > 1), dueReviewIds: items.filter((item) => !item.archived && item.reviewAt && Date.parse(item.reviewAt) <= now).map((item) => item.id), superseded: items.flatMap((item) => (item.supersedesIds ?? []).filter((id) => current.has(id)).map((id) => ({ id, by: item.id, approved: item.authority === "owner-approved" }))), unreviewedIds: items.filter((item) => !item.archived && (!item.authority || item.authority === "unreviewed")).map((item) => item.id) };
}

/** Metadata changes are explicit owner actions; no duplicate deletion or conflict resolution runs automatically. */
export function updateMemoryMetadata(ws: Workspace, id: string, patch: Metadata, expectedUpdatedAt?: string, at = new Date().toISOString()): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const note = ws.memories.find((item) => item.id === id);
  if (!note) return { ok: false, error: "That memory note is no longer available." };
  if (expectedUpdatedAt !== undefined && note.updatedAt !== expectedUpdatedAt) return { ok: false, error: "The note changed. Review its latest version before updating its metadata." };
  const metadata = normalizeMemoryMetadata({ ...note, ...patch });
  const { authority: _a, tags: _t, reviewAt: _r, supersedesIds: _s, sourceRef: _ref, ...rest } = note;
  void _a; void _t; void _r; void _s; void _ref;
  return { ok: true, ws: { ...ws, memories: ws.memories.map((item) => item.id === id ? { ...rest, ...metadata, updatedAt: at } : item) } };
}
