import { emptyFleet, readFleet } from "./fleet.ts";
import type {
  AuditEntry,
  Autonomy,
  Chat,
  LocalFile,
  MemoryItem,
  MemoryScope,
  Msg,
  MsgImage,
  Project,
  UsageEntry,
  Workspace,
} from "./types";

export const WORKSPACE_KEY = "amcos.workspace.v1";
const LEGACY_KEY = "amcos.chats.v1";

export function emptyWorkspace(): Workspace {
  return { version: 1, halted: false, chats: [], memories: [], projects: [], files: [], usage: [], audit: [], ...emptyFleet() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function memoriesForChat(ws: Workspace, chat: Chat): MemoryItem[] {
  if (chat.memory !== "on") return [];
  return ws.memories.filter((item) => {
    if (item.archived) return false;
    if (item.scope === "global") return true;
    if (item.scope === "project") return !!chat.projectId && item.projectId === chat.projectId;
    return item.scope === "chat" && item.chatId === chat.id;
  });
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeWorkspace(input: unknown): Workspace {
  return normalizeWorkspaceDetailed(input).workspace;
}

export function normalizeWorkspaceDetailed(input: unknown): {
  workspace: Workspace;
  report: WorkspaceNormalizeReport;
} {
  const report = emptyNormalizeReport();
  const base = emptyWorkspace();
  if (!isRecord(input)) {
    report.unsafeForBlobGc = true;
    return { workspace: base, report };
  }
  base.halted = input.halted === true;
  if (Array.isArray(input.projects)) {
    for (const row of input.projects) {
      if (!isRecord(row) || !str(row.id) || !str(row.name)) continue;
      base.projects.push({
        id: str(row.id),
        name: str(row.name).slice(0, 80),
        description: str(row.description).slice(0, 400),
        createdAt: str(row.createdAt, new Date(0).toISOString()),
      });
    }
  }
  if (Array.isArray(input.chats)) {
    for (const row of input.chats) {
      const normalized = normalizeChat(row);
      if (!normalized) {
        report.chatsDropped += 1;
        continue;
      }
      report.messagesDropped += normalized.messagesDropped;
      report.imagesDropped += normalized.imagesDropped;
      base.chats.push(normalized.chat);
    }
  } else if (input.chats !== undefined) {
    report.chatsDropped += 1;
  }
  if (Array.isArray(input.memories)) {
    for (const row of input.memories) {
      const item = normalizeMemory(row);
      if (item) base.memories.push(item);
    }
  }
  if (Array.isArray(input.files)) {
    for (const row of input.files) {
      const file = normalizeFile(row);
      if (file) base.files.push(file);
    }
  }
  if (Array.isArray(input.usage)) {
    for (const row of input.usage) {
      if (!isRecord(row) || !str(row.id)) continue;
      base.usage.push({
        id: str(row.id),
        chatId: str(row.chatId),
        at: str(row.at),
        model: str(row.model, "unknown"),
        requestId: typeof row.requestId === "string" ? row.requestId : null,
        promptTokens: typeof row.promptTokens === "number" ? row.promptTokens : null,
        completionTokens: typeof row.completionTokens === "number" ? row.completionTokens : null,
        kind: "actual",
      });
    }
  }
  if (Array.isArray(input.audit)) {
    for (const row of input.audit) {
      if (!isRecord(row) || !str(row.id)) continue;
      base.audit.push({
        id: str(row.id),
        at: str(row.at),
        action: str(row.action),
        target: str(row.target),
        result: str(row.result),
      });
    }
  }
  report.unsafeForBlobGc =
    report.chatsDropped > 0 || report.messagesDropped > 0 || report.imagesDropped > 0;
  return { workspace: { ...base, ...readFleet(input) }, report };
}


/** Same caps/shape as media save path (pack/harden): data-URL or blobId refs only. */
const MAX_MSG_IMAGES = 4;
const MAX_INLINE_DATA_URL_CHARS = 1_800_000;
const SAFE_MSG_DATA_URL =
  /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

export type WorkspaceNormalizeReport = {
  chatsDropped: number;
  messagesDropped: number;
  imagesDropped: number;
  /** True when any chat/message/image was rejected during normalize — GC must skip. */
  unsafeForBlobGc: boolean;
};

export function emptyNormalizeReport(): WorkspaceNormalizeReport {
  return { chatsDropped: 0, messagesDropped: 0, imagesDropped: 0, unsafeForBlobGc: false };
}

function normalizeMsgImage(raw: unknown): { image: MsgImage | null; dropped: boolean } {
  if (!isRecord(raw)) return { image: null, dropped: true };
  const name = typeof raw.name === "string" ? raw.name.slice(0, 160) : undefined;
  const mime = typeof raw.mime === "string" ? raw.mime.slice(0, 64) : undefined;
  const blobId =
    typeof raw.blobId === "string" && /^img_[A-Za-z0-9_-]{1,180}$/.test(raw.blobId) ? raw.blobId : undefined;
  let dataUrl: string | undefined;
  if (typeof raw.dataUrl === "string") {
    const trimmed = raw.dataUrl.trim();
    if (
      trimmed.length > 0 &&
      trimmed.length <= MAX_INLINE_DATA_URL_CHARS &&
      SAFE_MSG_DATA_URL.test(trimmed)
    ) {
      dataUrl = trimmed;
    }
  }
  if (!dataUrl && !blobId) return { image: null, dropped: true };
  const image: MsgImage = {};
  if (dataUrl) image.dataUrl = dataUrl;
  if (blobId) image.blobId = blobId;
  if (name) image.name = name;
  if (mime) image.mime = mime;
  return { image, dropped: false };
}

function normalizeMsgImages(raw: unknown): { images?: MsgImage[]; dropped: number } {
  if (raw === undefined) return { images: undefined, dropped: 0 };
  if (!Array.isArray(raw)) return { images: undefined, dropped: 1 };
  const images: MsgImage[] = [];
  let dropped = 0;
  for (const item of raw) {
    const result = normalizeMsgImage(item);
    if (!result.image) {
      dropped += 1;
      continue;
    }
    if (images.length >= MAX_MSG_IMAGES) {
      dropped += 1;
      continue;
    }
    images.push(result.image);
  }
  return { images: images.length ? images : undefined, dropped };
}

function normalizeChat(row: unknown): { chat: Chat; messagesDropped: number; imagesDropped: number } | null {
  if (!isRecord(row) || !str(row.id)) return null;
  const memory = row.memory === "on" ? "on" : "off";
  const autonomy: Autonomy = row.autonomy === "automatic" ? "automatic" : "ask";
  const messages: Msg[] = [];
  let messagesDropped = 0;
  let imagesDropped = 0;
  if (Array.isArray(row.messages)) {
    for (const msg of row.messages) {
      if (!isRecord(msg) || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") {
        messagesDropped += 1;
        continue;
      }
      const normalizedImages = normalizeMsgImages(msg.images);
      imagesDropped += normalizedImages.dropped;
      const next: Msg = {
        id: str(msg.id, crypto.randomUUID()),
        role: msg.role,
        content: msg.content,
        at: str(msg.at, new Date(0).toISOString()),
        model: typeof msg.model === "string" ? msg.model : undefined,
      };
      if (normalizedImages.images?.length) next.images = normalizedImages.images;
      messages.push(next);
    }
  } else if (row.messages !== undefined) {
    messagesDropped += 1;
  }
  const retrievalLog = Array.isArray(row.retrievalLog)
    ? row.retrievalLog.flatMap((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.ids)) return [];
        return [{ at: str(entry.at), ids: entry.ids.filter((id) => typeof id === "string") }];
      })
    : [];
  return {
    chat: {
      id: str(row.id),
      title: str(row.title, "New session").slice(0, 80),
      memory,
      temporary: row.temporary === true,
      autonomy,
      projectId: typeof row.projectId === "string" ? row.projectId : null,
      messages,
      retrievalLog,
    },
    messagesDropped,
    imagesDropped,
  };
}

function normalizeFile(row: unknown): LocalFile | null {
  if (!isRecord(row) || !str(row.id) || typeof row.text !== "string" || !row.text.trim()) return null;
  const text = row.text.slice(0, 40000);
  return {
    id: str(row.id),
    name: str(row.name, "untitled.txt").slice(0, 120),
    text,
    bytes: typeof row.bytes === "number" ? row.bytes : text.length,
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    createdAt: str(row.createdAt, new Date(0).toISOString()),
  };
}

function normalizeMemory(row: unknown): MemoryItem | null {
  if (!isRecord(row) || !str(row.id) || typeof row.text !== "string" || !row.text.trim()) return null;
  const scope: MemoryScope = row.scope === "project" || row.scope === "chat" ? row.scope : "global";
  const versions = Array.isArray(row.versions)
    ? row.versions.flatMap((version) => {
        if (!isRecord(version) || typeof version.text !== "string") return [];
        return [{ at: str(version.at), text: version.text }];
      })
    : [];
  return {
    id: str(row.id),
    scope,
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    chatId: typeof row.chatId === "string" ? row.chatId : null,
    text: row.text.slice(0, 2000),
    source: str(row.source, "owner").slice(0, 160),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    archived: row.archived === true,
    versions,
  };
}

export function loadWorkspace(storage: Pick<Storage, "getItem">): Workspace {
  return loadWorkspaceDetailed(storage).workspace;
}

export function loadWorkspaceDetailed(storage: Pick<Storage, "getItem">): {
  workspace: Workspace;
  report: WorkspaceNormalizeReport;
} {
  const current = storage.getItem(WORKSPACE_KEY);
  if (current) {
    try {
      return normalizeWorkspaceDetailed(JSON.parse(current));
    } catch {
      const report = emptyNormalizeReport();
      report.unsafeForBlobGc = true;
      return { workspace: emptyWorkspace(), report };
    }
  }
  const legacy = storage.getItem(LEGACY_KEY);
  if (!legacy) return { workspace: emptyWorkspace(), report: emptyNormalizeReport() };
  try {
    const chats = JSON.parse(legacy) as unknown;
    return normalizeWorkspaceDetailed({ version: 1, chats });
  } catch {
    const report = emptyNormalizeReport();
    report.unsafeForBlobGc = true;
    return { workspace: emptyWorkspace(), report };
  }
}

export function createChat(
  ws: Workspace,
  input: { memory: "off" | "on"; autonomy: Autonomy; temporary: boolean; projectId: string | null },
): { ws: Workspace; chat: Chat } {
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: "New session",
    memory: input.memory,
    temporary: input.temporary,
    autonomy: input.autonomy,
    projectId: input.projectId,
    messages: [],
    retrievalLog: [],
  };
  return { ws: { ...ws, chats: [chat, ...ws.chats] }, chat };
}

export function addMemory(
  ws: Workspace,
  input: { scope: MemoryScope; text: string; source: string; projectId: string | null; chatId: string | null },
): Workspace {
  const text = input.text.trim().slice(0, 2000);
  if (!text) return ws;
  const now = new Date().toISOString();
  const item: MemoryItem = {
    id: crypto.randomUUID(),
    scope: input.scope,
    projectId: input.scope === "global" ? null : input.projectId,
    chatId: input.scope === "chat" ? input.chatId : null,
    text,
    source: input.source.slice(0, 160),
    createdAt: now,
    updatedAt: now,
    archived: false,
    versions: [],
  };
  return { ...ws, memories: [item, ...ws.memories] };
}

export function reviseMemory(ws: Workspace, id: string, text: string): Workspace {
  const next = text.trim().slice(0, 2000);
  if (!next) return ws;
  return {
    ...ws,
    memories: ws.memories.map((item) =>
      item.id === id
        ? {
            ...item,
            versions: [...item.versions, { at: item.updatedAt || item.createdAt, text: item.text }],
            text: next,
            updatedAt: new Date().toISOString(),
          }
        : item,
    ),
  };
}

export function counts(ws: Workspace) {
  return {
    chats: ws.chats.length,
    messages: ws.chats.reduce((sum, chat) => sum + chat.messages.length, 0),
    memories: ws.memories.length,
    projects: ws.projects.length,
    files: ws.files.length,
  };
}

export async function packWorkspace(ws: Workspace, includeTemporary: boolean) {
  const workspace = normalizeWorkspace({
    ...ws,
    chats: includeTemporary ? ws.chats : ws.chats.filter((chat) => !chat.temporary),
  });
  return {
    product: "adrians-mind" as const,
    format: 1 as const,
    sha256: await sha256(canonical(workspace)),
    counts: counts(workspace),
    workspace,
  };
}

export async function unpackWorkspace(raw: string): Promise<
  | { ok: true; workspace: Workspace; counts: ReturnType<typeof counts> }
  | { ok: false; error: string }
> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!isRecord(parsed) || parsed.product !== "adrians-mind" || parsed.format !== 1) {
    return { ok: false, error: "This is not an Adrian's Mind archive." };
  }
  if (typeof parsed.sha256 !== "string") return { ok: false, error: "The archive has no integrity hash." };
  const workspace = normalizeWorkspace(parsed.workspace);
  const actual = await sha256(canonical(workspace));
  if (actual !== parsed.sha256) {
    return { ok: false, error: "Archive hash does not match. Nothing was imported." };
  }
  return { ok: true, workspace, counts: counts(workspace) };
}

export function mergeWorkspace(current: Workspace, incoming: Workspace): Workspace {
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const merge = <T extends { id: string }>(left: T[], right: T[]) => [...byId([...left, ...right]).values()];
  return {
    version: 1,
    halted: current.halted,
    chats: merge(current.chats, incoming.chats),
    memories: merge(current.memories, incoming.memories),
    projects: merge(current.projects, incoming.projects),
    files: merge(current.files, incoming.files),
    usage: merge(current.usage, incoming.usage),
    audit: merge(current.audit, incoming.audit),
    agents: merge(current.agents, incoming.agents),
    deployments: merge(current.deployments, incoming.deployments),
    runs: merge(current.runs, incoming.runs),
    runEvents: merge(current.runEvents, incoming.runEvents),
    connections: merge(current.connections, incoming.connections),
    mailboxes: merge(current.mailboxes, incoming.mailboxes),
    schedules: merge(current.schedules, incoming.schedules),
    pins: merge(current.pins, incoming.pins),
    browserSessions: merge(current.browserSessions, incoming.browserSessions),
  };
}

export function pushAudit(ws: Workspace, action: string, target: string, result: string): Workspace {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    target,
    result,
  };
  return { ...ws, audit: [entry, ...ws.audit].slice(0, 200) };
}

export function pushUsage(ws: Workspace, entry: Omit<UsageEntry, "kind">): Workspace {
  return { ...ws, usage: [{ ...entry, kind: "actual" as const }, ...ws.usage].slice(0, 200) };
}

export function addLocalFile(
  ws: Workspace,
  input: { name: string; text: string; projectId: string | null },
): Workspace {
  const text = input.text.slice(0, 40000);
  if (!text.trim()) return ws;
  const file: LocalFile = {
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 120) || "untitled.txt",
    text,
    bytes: new TextEncoder().encode(text).length,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
  };
  return { ...ws, files: [file, ...ws.files].slice(0, 40) };
}

export function addProject(ws: Workspace, name: string, description: string): { ws: Workspace; project: Project } {
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80) || "Untitled project",
    description: description.trim().slice(0, 400),
    createdAt: new Date().toISOString(),
  };
  return { ws: { ...ws, projects: [project, ...ws.projects] }, project };
}
