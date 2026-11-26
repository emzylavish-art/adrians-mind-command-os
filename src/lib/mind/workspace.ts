import { retainActivity } from "./connection-attention.ts";
import { isModelTier } from "./model-tiers.ts";
import { emptyFleet, readFleet } from "./fleet.ts";
import { normalizeBotModel } from "./bot-model.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import { DEFAULT_PERSONALITY_ID, normalizeCustomPersonality, resolvePersonalityId } from "./personalities/index.ts";
import { attachmentIssues, attachmentManifest } from "./media/attachment-integrity.ts";
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

export const PROJECT_NAME_MAX = 80;
export const WORKSPACE_KEY = "amcos.workspace.v1";
const LEGACY_KEY = "amcos.chats.v1";
const OWNER_EMAIL = "emzylavish@gmail.com";

/** A real account never reads the shared preview key or another account's key. */
export function accountWorkspaceKey(userId: string | null | undefined): string {
  if (!userId || userId === "dev-user") return WORKSPACE_KEY;
  return `${WORKSPACE_KEY}.u.${encodeURIComponent(userId)}`;
}

export function isPrimaryOwner(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL;
}

export function loadWorkspaceForAccount(
  storage: Pick<Storage, "getItem">,
  userId: string | null | undefined,
  verifiedEmail?: string | null,
): Workspace {
  if (!userId) return emptyWorkspace();
  const key = accountWorkspaceKey(userId);
  const current = storage.getItem(key);
  const raw = current ?? (userId !== "dev-user" && isPrimaryOwner(verifiedEmail) ? storage.getItem(WORKSPACE_KEY) : null);
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
  if (chat.memory !== "on" || chat.temporary) return [];
  return ws.memories.filter((item) => {
    if (item.archived) return false;
    if (item.scope === "global") return true;
    if (item.scope === "project") return !!chat.projectId && item.projectId === chat.projectId;
    return item.scope === "chat" && item.chatId === chat.id;
  });
}

/** Data a conversational tool or voice assistant may read in this chat. */
export function workspaceForChat(ws: Workspace, chat: Chat): Workspace {
  const context = chat.memory === "on" && !chat.temporary;
  return {
    ...ws,
    memories: memoriesForChat(ws, chat),
    chats: context ? ws.chats.filter((row) => row.id === chat.id) : [],
    projects: context ? ws.projects.filter((row) => row.id === chat.projectId) : [],
    files: context && chat.projectId ? ws.files.filter((row) => row.projectId === chat.projectId) : [],
    agents: [], connections: [], schedules: [],
  };
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
        name: str(row.name).slice(0, PROJECT_NAME_MAX),
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
  const deleted = new Set(Array.isArray(input.deletedMemoryIds)
    ? input.deletedMemoryIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []);
  if (deleted.size) base.deletedMemoryIds = [...deleted];
  if (Array.isArray(input.memories)) {
    for (const row of input.memories) {
      const item = normalizeMemory(row);
      if (item && !deleted.has(item.id)) base.memories.push(item);
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
      const promptTokens = typeof row.promptTokens === "number" && Number.isSafeInteger(row.promptTokens) && row.promptTokens >= 0 ? row.promptTokens : null;
      const completionTokens = typeof row.completionTokens === "number" && Number.isSafeInteger(row.completionTokens) && row.completionTokens >= 0 ? row.completionTokens : null;
      base.usage.push({
        id: str(row.id),
        chatId: str(row.chatId),
        at: str(row.at),
        provider: typeof row.provider === "string" ? row.provider : undefined,
        requestedModel: typeof row.requestedModel === "string" ? row.requestedModel : undefined,
        model: str(row.model, "unknown"),
        requestId: typeof row.requestId === "string" ? row.requestId : null,
        promptTokens,
        completionTokens,
        kind: usageKind(promptTokens, completionTokens),
        ...(typeof row.operationId === "string" ? { operationId: row.operationId.slice(0, 120) } : {}),
        ...(row.outcome === "completed" || row.outcome === "failed" || row.outcome === "stopped" || row.outcome === "unknown" ? { outcome: row.outcome } : {}),
        ...(row.role === "primary" || row.role === "helper" ? { role: row.role } : {}),
        ...(row.executionLocation === "local" || row.executionLocation === "hosted" ? { executionLocation: row.executionLocation } : {}),
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
      const route = msg.deliveryRoute;
      const recovery = msg.role === "user" && isRecord(route) && typeof route.provider === "string" && route.provider.length <= 600 &&
        isModelTier(route.tier) && typeof route.fingerprint === "string" && /^[a-f0-9]{64}$/.test(route.fingerprint)
        ? { provider: route.provider, tier: route.tier, model: typeof route.model === "string" ? route.model.slice(0, 150) : null,
            orchestrated: route.orchestrated === true, fingerprint: route.fingerprint } : null;
      messages.push({
        ...(recovery ? { deliveryRoute: recovery } : {}),
        id: str(msg.id, crypto.randomUUID()),
        role: msg.role,
        content: msg.content,
        at: str(msg.at, new Date(0).toISOString()),
        model: typeof msg.model === "string" ? msg.model : undefined,
        ...(typeof msg.provider === "string" && msg.provider.trim() ? { provider: msg.provider.trim() } : {}),
        ...(msg.routingMode === "A" || msg.routingMode === "B" || msg.routingMode === "C" || msg.routingMode === "D" ? { routingMode: msg.routingMode } : {}),
        ...(typeof msg.requestedModel === "string" && msg.requestedModel.trim() ? { requestedModel: msg.requestedModel.trim().slice(0, 150) } : {}),
        ...(msg.role === "user" && typeof msg.deliveryOperationId === "string" && /^\d{13}-[a-f0-9-]{36}$/i.test(msg.deliveryOperationId) ? { deliveryOperationId: msg.deliveryOperationId } : {}),
        ...(msg.role === "user" && (msg.delivery === "submitted" || msg.delivery === "unconfirmed" || msg.delivery === "stopped" || msg.delivery === "failed") ? { delivery: msg.delivery } : {}),
        ...(msg.replyStatus === "streaming" || msg.replyStatus === "interrupted" || msg.replyStatus === "complete" ? { replyStatus: msg.replyStatus } : {}),
        ...(typeof msg.replyOperationId === "string" ? { replyOperationId: msg.replyOperationId.slice(0, 120) } : {}),
        ...(typeof msg.contextNotice === "string" ? { contextNotice: msg.contextNotice.slice(0, 2000) } : {}),
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
    ...(typeof row.notionWorkspaceId === "string" && row.notionWorkspaceId.length <= 200 ? { notionWorkspaceId: row.notionWorkspaceId } : {}),
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
    name: str(row.name, "untitled.txt"),
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
  for (const item of value) {
    if (!isRecord(item)) continue;
    // Storage normalization preserves bytes. Transport validators enforce limits
    // before saving, so a successful save can never hide an oversized omission.
    const dataUrl = typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/") ? item.dataUrl : undefined;
    const blobId = typeof item.blobId === "string" && item.blobId.length > 0 && item.blobId.length < 200 ? item.blobId : undefined;
    if (!dataUrl && !blobId) continue;
    images.push({
      dataUrl,
      blobId,
      ...(item.origin === "attached" || item.origin === "camera" || item.origin === "generated" || item.origin === "edited" ? { origin: item.origin } : {}),
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
  if (row.scope != null && !["chat", "project", "global"].includes(String(row.scope))) return null;
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
    ...(row.alwaysApply === true ? { alwaysApply: true } : {}),
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
  if (!ws.memories.some((item) => item.id === id)) return ws;
  return { ...ws, deletedMemoryIds: [...new Set([...(ws.deletedMemoryIds ?? []), id])], memories: ws.memories.filter((item) => item.id !== id) };
}

export function reviseMemory(ws: Workspace, id: string, text: string): Workspace {
  const next = text.trim().slice(0, 2000);
  if (!next || ws.memories.find((note) => note.id === id)?.text === next) return ws;
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
    attachments: attachmentManifest(workspace),
    workspace,
  };
}

export async function unpackWorkspace(raw: string): Promise<
  | { ok: true; workspace: Workspace; counts: ReturnType<typeof counts>; attachments: ReturnType<typeof attachmentManifest>; warnings: string[] }
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
  const attachments = attachmentManifest(workspace);
  const warnings = attachmentIssues(workspace).map((issue) => `${issue.name}: ${issue.reason}`);
  if (!attachments.complete) warnings.unshift(`${attachments.referenced - attachments.included} image attachment(s) have references but no image bytes in this archive. They may be unavailable on another device.`);
  return { ok: true, workspace, counts: counts(workspace), attachments, warnings };
}

export function mergeMemoryState(current: Workspace, incoming: Workspace): Pick<Workspace, "memories" | "deletedMemoryIds"> {
  const deleted = new Set([...(current.deletedMemoryIds ?? []), ...(incoming.deletedMemoryIds ?? [])]);
  const memories = new Map<string, MemoryItem>();
  for (const note of [...current.memories, ...incoming.memories]) {
    if (deleted.has(note.id)) continue;
    const previous = memories.get(note.id);
    if (!previous || note.updatedAt > previous.updatedAt ||
        (note.updatedAt === previous.updatedAt && (note.versions.length > previous.versions.length ||
          (note.versions.length === previous.versions.length && note.archived && !previous.archived)))) {
      memories.set(note.id, note);
    }
  }
  return { memories: [...memories.values()], ...(deleted.size ? { deletedMemoryIds: [...deleted] } : {}) };
}

/** Explicit replacement can restore forgotten content only as newly saved notes. */
export function replaceFromArchive(current: Workspace, archive: Workspace): Workspace {
  const deleted = new Set([...(current.deletedMemoryIds ?? []), ...(archive.deletedMemoryIds ?? [])]);
  const incoming = new Set(archive.memories.map((note) => note.id));
  for (const note of current.memories) if (!incoming.has(note.id)) deleted.add(note.id);
  const now = new Date().toISOString();
  const memories = archive.memories.map((note) => {
    if (deleted.has(note.id)) return { ...note, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    const previous = current.memories.find((item) => item.id === note.id);
    if (previous && (previous.text !== note.text || previous.archived !== note.archived)) {
      return { ...note, updatedAt: now, versions: [...previous.versions, { at: previous.updatedAt, text: previous.text }] };
    }
    return note;
  });
  return { ...archive, memories, deletedMemoryIds: [...deleted], halted: current.halted || archive.halted };
}

export function archiveMessagePreview(current: Workspace, incoming: Workspace) {
  const existing = new Map(current.chats.map((chat) => [chat.id, chat]));
  const conflicts: string[] = [];
  let kept = 0;
  for (const chat of incoming.chats) {
    const local = existing.get(chat.id);
    if (!local) continue;
    const archive = new Map(chat.messages.map((message) => [message.id, message]));
    for (const message of local.messages) {
      const other = archive.get(message.id);
      if (!other) kept++;
      else if (canonical(other) !== canonical(message)) conflicts.push(chat.title);
    }
  }
  return { kept, conflicts };
}

export function mergeWorkspace(current: Workspace, incoming: Workspace): Workspace {
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const merge = <T extends { id: string }>(left: T[], right: T[]) => [...byId([...left, ...right]).values()];
  const archivedChats = byId(incoming.chats);
  return {
    version: 1,
    halted: current.halted,
    chats: [...byId([...incoming.chats, ...current.chats]).values()].map((chat) => {
      const archive = archivedChats.get(chat.id);
      if (!archive || archive === chat) return chat;
      const messages = merge(archive.messages, chat.messages).sort((a, b) => a.at.localeCompare(b.at));
      return { ...chat, temporary: chat.temporary || archive.temporary, messages };
    }),
    ...mergeMemoryState(current, incoming),
    projects: merge(current.projects, incoming.projects),
    files: merge(current.files, incoming.files),
    usage: merge(current.usage, incoming.usage).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    audit: retainActivity(merge(current.audit, incoming.audit).sort((a, b) => b.at.localeCompare(a.at))),
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
  return { ws: { ...ws, audit: retainActivity([entry, ...ws.audit]) }, entry };
}

export function pushAudit(ws: Workspace, action: string, target: string, result: string): Workspace {
  return recordAudit(ws, action, target, result).ws;
}

function usageKind(prompt: unknown, completion: unknown): UsageEntry["kind"] {
  const valid = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (valid(prompt) && valid(completion)) return "actual";
  return valid(prompt) || valid(completion) ? "partial" : "unknown";
}

export function pushUsage(ws: Workspace, entry: Omit<UsageEntry, "kind">): Workspace {
  return { ...ws, usage: [{ ...entry, kind: usageKind(entry.promptTokens, entry.completionTokens) }, ...ws.usage].slice(0, 200) };
}

export function addLocalFile(
  ws: Workspace,
  input: { id?: string; name: string; text: string; partial?: boolean; projectId: string | null },
): Workspace {
  if (ws.files.length >= 40) return ws;
  const text = input.text.slice(0, 40000);
  if (!text.trim()) return ws;
  const file: LocalFile = {
    id: input.id || crypto.randomUUID(),
    name: input.name || "untitled.txt",
    text,
    bytes: new TextEncoder().encode(text).length,
    ...(input.partial || input.text.length > text.length ? { partial: true } : {}),
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
  };
  return { ...ws, files: [file, ...ws.files] };
}

export function addProject(ws: Workspace, name: string, description: string): { ws: Workspace; project: Project } {
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, PROJECT_NAME_MAX) || "Untitled project",
    description: description.trim().slice(0, 400),
    createdAt: new Date().toISOString(),
  };
  return { ws: { ...ws, projects: [project, ...ws.projects] }, project };
}
