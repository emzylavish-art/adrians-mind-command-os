import { emptyFleet, readFleet } from "./fleet.ts";
import { normalizeBotModel } from "./bot-model.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import { DEFAULT_PERSONALITY_ID, normalizeCustomPersonality, resolvePersonalityId } from "./personalities/index.ts";
import type {
  AuditEntry,
  Autonomy,
  Chat,
  LocalFile,
  MemoryItem,
  MemoryScope,
  Msg,
  Project,
  UsageEntry,
  Workspace,
} from "./types";

export const WORKSPACE_KEY = "amcos.workspace.v1";
const LEGACY_KEY = "amcos.chats.v1";
const OWNER_EMAIL = "emzylavish@gmail.com";

/** A real account never reads the shared preview key or another account's key. */
export function accountWorkspaceKey(userId: string | null | undefined): string {
  if (!userId || userId === "dev-user") return WORKSPACE_KEY;
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `${WORKSPACE_KEY}.u.${safe || "account"}`;
}

export function isPrimaryOwner(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL;
}

export function loadWorkspaceForAccount(
  storage: Pick<Storage, "getItem">,
  userId: string | null | undefined,
  email?: string | null,
): Workspace {
  if (!userId) return emptyWorkspace();
  const key = accountWorkspaceKey(userId);
  const current = storage.getItem(key);
  const raw = current ?? (userId !== "dev-user" && isPrimaryOwner(email) ? storage.getItem(WORKSPACE_KEY) : null);
  if (!raw) return emptyWorkspace();
  try {
    return normalizeWorkspace(JSON.parse(raw));
  } catch {
    return emptyWorkspace();
  }
}

export function emptyWorkspace(): Workspace {
  return { version: 1, halted: false, chats: [], memories: [], projects: [], files: [], usage: [], audit: [], ...emptyFleet() };
}

/** Clears chats, notes, projects, files, and bots. The emergency stop stays as it was. */
export function clearedBrowserCopy(prev: Workspace): Workspace {
  return pushAudit(
    { ...emptyWorkspace(), halted: prev.halted },
    "wipe_browser",
    "workspace",
    "cleared",
  );
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
  const base = emptyWorkspace();
  if (!isRecord(input)) return base;
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
      const chat = normalizeChat(row);
      if (chat) base.chats.push(chat);
    }
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
  return { ...base, ...readFleet(input) };
}

function normalizeChat(row: unknown): Chat | null {
  if (!isRecord(row) || !str(row.id)) return null;
  const memory = row.memory === "on" ? "on" : "off";
  const autonomy: Autonomy = row.autonomy === "automatic" ? "automatic" : "ask";
  const messages: Msg[] = [];
  if (Array.isArray(row.messages)) {
    for (const msg of row.messages) {
      if (!isRecord(msg) || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") {
        continue;
      }
      messages.push({
        id: str(msg.id, crypto.randomUUID()),
        role: msg.role,
        content: msg.content,
        at: str(msg.at, new Date(0).toISOString()),
        model: typeof msg.model === "string" ? msg.model : undefined,
        ...publicImages(msg.images),
        ...publicVideo(msg.videoUrl),
        ...(msg.memorySaved === true
          ? {
              memorySaved: true as const,
              savedMemoryId: typeof msg.savedMemoryId === "string" ? msg.savedMemoryId : null,
            }
          : {}),
      });
    }
  }
  const retrievalLog = Array.isArray(row.retrievalLog)
    ? row.retrievalLog.flatMap((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.ids)) return [];
        return [{ at: str(entry.at), ids: entry.ids.filter((id) => typeof id === "string") }];
      })
    : [];
  return {
    id: str(row.id),
    title: str(row.title, "New session").slice(0, 80),
    ...(typeof row.agentId === "string" && row.agentId ? { agentId: row.agentId } : {}),
    ...chatBotModel(row),
    memory,
    temporary: row.temporary === true,
    autonomy,
    personalityId: resolvePersonalityId(row.personalityId),
    customPersonality: typeof row.customPersonality === "string" ? row.customPersonality.slice(0, 800) : "",
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    messages,
    retrievalLog,
    ...(row.favorite === true ? { favorite: true as const } : {}),
    ...(row.archived === true ? { archived: true as const } : {}),
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
    ...(row.partial === true || row.text.length > text.length ? { partial: true } : {}),
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    createdAt: str(row.createdAt, new Date(0).toISOString()),
  };
}

function publicImages(value: unknown): { images: NonNullable<Msg["images"]> } | Record<string, never> {
  if (!Array.isArray(value)) return {};
  const images: NonNullable<Msg["images"]> = [];
  for (const item of value.slice(0, 4)) {
    if (!isRecord(item)) continue;
    const dataUrl = typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/") && item.dataUrl.length < 1_500_000 ? item.dataUrl : undefined;
    const blobId = typeof item.blobId === "string" && item.blobId.length > 0 && item.blobId.length < 200 ? item.blobId : undefined;
    if (!dataUrl && !blobId) continue;
    images.push({
      dataUrl,
      blobId,
      name: typeof item.name === "string" ? item.name.slice(0, 120) : undefined,
      mime: typeof item.mime === "string" ? item.mime.slice(0, 40) : undefined,
    });
  }
  return images.length ? { images } : {};
}

function publicVideo(value: unknown): { videoUrl: string } | Record<string, never> {
  if (typeof value !== "string" || value.length > 2000) return {};
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return {};
    return { videoUrl: url.toString() };
  } catch {
    return {};
  }
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
  const current = storage.getItem(WORKSPACE_KEY);
  if (current) {
    try {
      return normalizeWorkspace(JSON.parse(current));
    } catch {
      return emptyWorkspace();
    }
  }
  const legacy = storage.getItem(LEGACY_KEY);
  if (!legacy) return emptyWorkspace();
  try {
    const chats = JSON.parse(legacy) as unknown;
    return normalizeWorkspace({ version: 1, chats });
  } catch {
    return emptyWorkspace();
  }
}

export function createChat(
  ws: Workspace,
  input: { memory: "off" | "on"; autonomy: Autonomy; temporary: boolean; projectId: string | null; personalityId?: unknown; customPersonality?: unknown },
): { ws: Workspace; chat: Chat } {
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: "New session",
    memory: input.memory,
    temporary: input.temporary,
    autonomy: input.autonomy,
    personalityId: resolvePersonalityId(input.personalityId ?? DEFAULT_PERSONALITY_ID),
    customPersonality: normalizeCustomPersonality(input.customPersonality),
    projectId: input.projectId,
    messages: [],
    retrievalLog: [],
  };
  return { ws: { ...ws, chats: [chat, ...ws.chats] }, chat };
}

/** Open the latest bot conversation unless the owner explicitly starts another. */
export function openBotChat(ws: Workspace, agentId: string, newThread = false): { ws: Workspace; chat: Chat } | null {
  const agent = ws.agents.find((item) => item.id === agentId && !item.archived);
  if (!agent) return null;
  const existing = !newThread && ws.chats.find((chat) => chat.agentId === agentId);
  if (existing) return { ws, chat: existing };
  const { chat } = createChat(ws, {
    memory: agent.memory,
    autonomy: agent.approval,
    temporary: false,
    projectId: agent.projectId,
    personalityId: "custom",
    customPersonality: agent.instructions,
  });
  const linked = { ...chat, title: agent.name, agentId };
  const model = normalizeBotModel(agent);
  if (model.chatProvider) linked.botProvider = model.chatProvider;
  if (model.chatTier) linked.botTier = model.chatTier;
  const knowledge = normalizeBotKnowledge(agent.knowledge).knowledge;
  if (knowledge) linked.botKnowledge = knowledge;
  return { ws: { ...ws, chats: [linked, ...ws.chats] }, chat: linked };
}

function chatBotModel(row: Record<string, unknown>) {
  const model = normalizeBotModel({ chatProvider: row.botProvider, chatTier: row.botTier });
  const knowledge = normalizeBotKnowledge(row.botKnowledge).knowledge;
  return {
    ...(model.chatProvider ? { botProvider: model.chatProvider } : {}),
    ...(model.chatTier ? { botTier: model.chatTier } : {}),
    ...(knowledge ? { botKnowledge: knowledge } : {}),
  };
}

export function updateChatPersonality(ws: Workspace, chatId: string, personalityId: unknown): Workspace {
  const next = resolvePersonalityId(personalityId);
  if (!chatId || !ws.chats.some((chat) => chat.id === chatId)) return ws;
  return {
    ...ws,
    chats: ws.chats.map((chat) => chat.id === chatId ? { ...chat, personalityId: next } : chat),
  };
}

export function updateChatCustomPersonality(ws: Workspace, chatId: string, customPersonality: unknown): Workspace {
  const next = typeof customPersonality === "string" ? customPersonality.slice(0, 800) : "";
  if (!chatId || !ws.chats.some((chat) => chat.id === chatId)) return ws;
  return {
    ...ws,
    chats: ws.chats.map((chat) => chat.id === chatId ? { ...chat, customPersonality: next } : chat),
  };
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

export function deleteMemory(ws: Workspace, id: string): Workspace {
  if (!id) return ws;
  return { ...ws, memories: ws.memories.filter((item) => item.id !== id) };
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

export function recordAudit(ws: Workspace, action: string, target: string, result: string): { ws: Workspace; entry: AuditEntry } {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    target,
    result,
  };
  return { ws: { ...ws, audit: [entry, ...ws.audit].slice(0, 200) }, entry };
}

export function pushAudit(ws: Workspace, action: string, target: string, result: string): Workspace {
  return recordAudit(ws, action, target, result).ws;
}

export function pushUsage(ws: Workspace, entry: Omit<UsageEntry, "kind">): Workspace {
  return { ...ws, usage: [{ ...entry, kind: "actual" as const }, ...ws.usage].slice(0, 200) };
}

export function addLocalFile(
  ws: Workspace,
  input: { id?: string; name: string; text: string; partial?: boolean; projectId: string | null },
): Workspace {
  const text = input.text.slice(0, 40000);
  if (!text.trim()) return ws;
  const file: LocalFile = {
    id: input.id || crypto.randomUUID(),
    name: input.name.trim().slice(0, 120) || "untitled.txt",
    text,
    bytes: new TextEncoder().encode(text).length,
    ...(input.partial || input.text.length > text.length ? { partial: true } : {}),
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
