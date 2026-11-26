import { readPdfEvidenceIndex } from "./pdf-evidence.ts";
import { readExecutionEvidence } from "./execution-evidence.ts";
import { retainActivity } from "./connection-attention.ts";
import { isModelTier } from "./model-tiers.ts";
import { emptyFleet, readFleet } from "./fleet.ts";
import { normalizeBotModel } from "./bot-model.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import { effectiveContextPolicy, normalizeContextPolicy } from "./memory/context-policy.ts";
import { MAX_DOCUMENT_TEXT_CHARS, MAX_LIBRARY_FILES } from "./knowledge-limits.ts";
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
  WorkspaceJsonValue,
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
  const policy = effectiveContextPolicy(chat);
  const projectContext = chat.contextPolicy?.projectDocuments === undefined ? context : policy.projectDocuments;
  return {
    ...ws,
    memories: memoriesForChat(ws, chat),
    chats: context ? ws.chats.filter((row) => row.id === chat.id) : [],
    projects: projectContext ? ws.projects.filter((row) => row.id === chat.projectId) : [],
    files: projectContext && chat.projectId ? ws.files.filter((row) => row.projectId === chat.projectId && !row.archived && !row.retrievalDisabled) : [],
    agents: [], connections: [], schedules: [],
  };
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/** Conflict variants cross the server-function boundary as explicit JSON data. */
export function workspaceJsonValue(value: unknown): WorkspaceJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(workspaceJsonValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, workspaceJsonValue(entry)]));
  return null;
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
  if (isRecord(input.toolPermissions)) {
    const permissions = input.toolPermissions;
    base.toolPermissions = Object.fromEntries(["list_projects", "list_chats", "search_notes"].filter((key) => typeof permissions[key] === "boolean").map((key) => [key, permissions[key] as boolean]));
  }
  if (Array.isArray(input.syncConflicts)) {
    base.syncConflicts = input.syncConflicts.filter((row) => isRecord(row) && typeof row.id === "string" && typeof row.collection === "string" && typeof row.recordId === "string" && typeof row.field === "string" && !["__proto__", "constructor", "prototype"].includes(row.field))
      .map((row) => ({ id: String(row.id), collection: String(row.collection), recordId: String(row.recordId), field: String(row.field), local: workspaceJsonValue(row.local), remote: workspaceJsonValue(row.remote) }));
  }
  if (Array.isArray(input.projects)) {
    for (const row of input.projects) {
      if (!isRecord(row) || !str(row.id) || !str(row.name)) continue;
      base.projects.push({
        id: str(row.id),
        name: str(row.name).slice(0, PROJECT_NAME_MAX),
        description: str(row.description).slice(0, 400),
        createdAt: str(row.createdAt, new Date(0).toISOString()),
        ...(row.archived === true ? { archived: true } : {}),
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
      base.usage.push({
        ...(typeof row.executionId === "string" && row.executionId.length <= 200 ? { executionId: row.executionId } : {}),
        id: str(row.id),
        chatId: str(row.chatId),
        at: str(row.at),
        provider: typeof row.provider === "string" ? row.provider : undefined,
        requestedModel: typeof row.requestedModel === "string" ? row.requestedModel : undefined,
        model: str(row.model, "unknown"),
        requestId: typeof row.requestId === "string" ? row.requestId : null,
        promptTokens: typeof row.promptTokens === "number" ? row.promptTokens : null,
        completionTokens: typeof row.completionTokens === "number" ? row.completionTokens : null,
        kind: usageKind(row.promptTokens, row.completionTokens),
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
        ...(readExecutionEvidence(msg.executionEvidence, typeof msg.executionId === "string" ? msg.executionId : undefined) ? { executionEvidence: readExecutionEvidence(msg.executionEvidence, typeof msg.executionId === "string" ? msg.executionId : undefined) } : {}),
        ...(typeof msg.executionId === "string" && msg.executionId.length > 0 && msg.executionId.length <= 200 ? { executionId: msg.executionId } : {}),
        ...(Array.isArray(msg.helperReceipts) ? { helperReceipts: msg.helperReceipts.filter((receipt) => isRecord(receipt) && typeof receipt.id === "string" && ["succeeded", "failed", "canceled", "skipped"].includes(String(receipt.status))).slice(0, 8).map((receipt) => ({
          id: String(receipt.id).slice(0, 600), status: receipt.status as "succeeded" | "failed" | "canceled" | "skipped", contributed: receipt.contributed === true,
          model: typeof receipt.model === "string" ? receipt.model.slice(0, 200) : null, requestedModel: typeof receipt.requestedModel === "string" ? receipt.requestedModel.slice(0, 200) : null,
          requestId: typeof receipt.requestId === "string" ? receipt.requestId.slice(0, 200) : null, durationMs: typeof receipt.durationMs === "number" && Number.isFinite(receipt.durationMs) ? Math.max(0, receipt.durationMs) : 0,
          error: typeof receipt.error === "string" ? receipt.error.slice(0, 500) : null,
          usage: isRecord(receipt.usage) ? { ...(typeof receipt.usage.prompt_tokens === "number" ? { prompt_tokens: receipt.usage.prompt_tokens } : {}), ...(typeof receipt.usage.completion_tokens === "number" ? { completion_tokens: receipt.usage.completion_tokens } : {}) } : null,
        })) } : {}),
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
        ...publicImages(msg.images),
        ...publicVideo(msg.videoUrl),
        ...(typeof msg.videoOperationId === "string" && msg.videoOperationId.length <= 200 ? { videoOperationId: msg.videoOperationId } : {}),
        ...(["provider-temporary", "local-download", "account-storage"].includes(String(msg.videoRetention)) ? { videoRetention: msg.videoRetention as "provider-temporary" | "local-download" | "account-storage" } : {}),
        ...(msg.videoExpiresAt === null || (typeof msg.videoExpiresAt === "string" && msg.videoExpiresAt.length <= 100) ? { videoExpiresAt: msg.videoExpiresAt } : {}),
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
    ...(typeof row.botRevision === "number" && Number.isSafeInteger(row.botRevision) ? { botRevision: row.botRevision } : {}),
    ...(Array.isArray(row.documentSources) ? { documentSources: row.documentSources.filter((item) => isRecord(item) && typeof item.fileId === "string" && typeof item.revision === "string" && typeof item.name === "string").map((item) => ({ fileId: String(item.fileId), revision: String(item.revision), name: String(item.name), ...(typeof item.messageId === "string" ? { messageId: item.messageId } : {}) })) } : {}),
    ...chatBotModel(row),
    memory,
    ...(normalizeContextPolicy(row.contextPolicy) ? { contextPolicy: normalizeContextPolicy(row.contextPolicy) } : {}),
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
  const text = row.text.slice(0, MAX_DOCUMENT_TEXT_CHARS);
  return {
    id: str(row.id),
    name: str(row.name, "untitled.txt"),
    ...(readPdfEvidenceIndex(row.evidenceIndex, text.length) ? { evidenceIndex: readPdfEvidenceIndex(row.evidenceIndex, text.length) } : {}),
    text,
    bytes: typeof row.bytes === "number" ? row.bytes : text.length,
    ...(row.partial === true || row.text.length > text.length ? { partial: true } : {}),
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    createdAt: str(row.createdAt, new Date(0).toISOString()),
    ...(row.text.length === text.length && typeof row.textSha256 === "string" && /^[a-f0-9]{64}$/.test(row.textSha256) ? { textSha256: row.textSha256 } : {}),
    ...(typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision > 0 ? { revision: row.revision } : {}),
    ...(typeof row.previousVersionId === "string" ? { previousVersionId: row.previousVersionId } : {}),
    ...(row.archived === true ? { archived: true } : {}),
    ...(row.retrievalDisabled === true ? { retrievalDisabled: true } : {}),
    ...(isRecord(row.original) && typeof row.original.id === "string" && typeof row.original.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.original.sha256) && typeof row.original.bytes === "number" && typeof row.original.mime === "string" && row.original.storage === "browser"
      ? { original: { id: row.original.id, sha256: row.original.sha256, bytes: row.original.bytes, mime: row.original.mime, storage: "browser" as const } } : {}),
    ...(isRecord(row.extraction) && ["plain-text", "pdf-text", "legacy"].includes(String(row.extraction.method)) && typeof row.extraction.extractedCharacters === "number" && typeof row.extraction.retainedCharacters === "number"
      ? { extraction: { method: row.extraction.method as "plain-text" | "pdf-text" | "legacy", extractedCharacters: row.extraction.extractedCharacters, retainedCharacters: row.extraction.retainedCharacters, coverage: str(row.extraction.coverage), at: str(row.extraction.at) } } : {}),
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
      ...Object.fromEntries(["assetId", "parentAssetId", "operationId", "createdAt"].filter((key) => typeof item[key] === "string" && (item[key] as string).length > 0 && (item[key] as string).length <= 200).map((key) => [key, item[key]])),
      ...(typeof item.editPrompt === "string" ? { editPrompt: item.editPrompt.slice(0, 6000) } : {}),
      ...(typeof item.preferred === "boolean" ? { preferred: item.preferred } : {}),
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
  const linked = { ...chat, title: agent.name, agentId, botRevision: agent.version };
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
    resources: {
      extractedDocuments: workspace.files.map((file) => ({ id: file.id, name: file.name, partial: file.partial === true, revision: file.textSha256 ?? null })),
      excludedOriginals: workspace.files.filter((file) => file.original).map((file) => ({ fileId: file.id, name: file.name, reason: "Original bytes are stored on this browser and are not embedded in this JSON archive." })),
    },
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
  input: { id?: string; name: string; text: string; partial?: boolean; projectId: string | null; textSha256?: string; original?: LocalFile["original"]; extraction?: LocalFile["extraction"]; evidenceIndex?: LocalFile["evidenceIndex"]; previousVersionId?: string },
): Workspace {
  if (ws.files.length >= MAX_LIBRARY_FILES) return ws;
  const text = input.text.slice(0, MAX_DOCUMENT_TEXT_CHARS);
  if (!text.trim()) return ws;
  const file: LocalFile = {
    id: input.id || crypto.randomUUID(),
    name: input.name || "untitled.txt",
    ...(readPdfEvidenceIndex(input.evidenceIndex, text.length) ? { evidenceIndex: readPdfEvidenceIndex(input.evidenceIndex, text.length) } : {}),
    text,
    bytes: new TextEncoder().encode(text).length,
    ...(input.partial || input.text.length > text.length ? { partial: true } : {}),
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    revision: input.previousVersionId ? (ws.files.find((row) => row.id === input.previousVersionId)?.revision ?? 1) + 1 : 1,
    ...(input.text.length === text.length && input.textSha256 ? { textSha256: input.textSha256 } : {}),
    ...(input.original ? { original: input.original } : {}),
    ...(input.extraction ? { extraction: input.extraction } : {}),
    ...(input.previousVersionId ? { previousVersionId: input.previousVersionId } : {}),
  };
  return { ...ws, files: [file, ...ws.files.map((row) => row.id === input.previousVersionId ? { ...row, archived: true } : row)] };
}

export function setProjectArchived(ws: Workspace, id: string, archived: boolean): Workspace {
  return { ...ws, projects: ws.projects.map((project) => project.id === id ? { ...project, archived } : project) };
}

/** Deletion removes organization, preserves history and revokes future project execution. */
export function deleteProject(ws: Workspace, id: string): Workspace {
  const affected = new Set(ws.agents.filter((agent) => agent.projectId === id).map((agent) => agent.id));
  return {
    ...ws,
    projects: ws.projects.filter((project) => project.id !== id),
    chats: ws.chats.map((chat) => chat.projectId === id ? { ...chat, projectId: null, contextPolicy: { ...chat.contextPolicy, projectDocuments: false, projectConversations: false } } : chat),
    files: ws.files.map((file) => file.projectId === id ? { ...file, projectId: null } : file),
    // Former-project notes retain their original scope; never broaden them to global.
    agents: ws.agents.map((agent) => affected.has(agent.id) ? { ...agent, projectId: null, archived: true, version: agent.version + 1, updatedAt: new Date().toISOString() } : agent),
    schedules: ws.schedules.map((schedule) => schedule.agentId && affected.has(schedule.agentId) ? { ...schedule, enabled: false } : schedule),
  };
}

export function botConversationRevision(ws: Workspace, chat: Chat) {
  const agent = ws.agents.find((item) => item.id === chat.agentId);
  return { current: agent?.version ?? null, pinned: chat.botRevision ?? null, unavailable: !agent || agent.archived,
    requiresReview: Boolean(chat.agentId && (!agent || agent.archived || chat.botRevision !== agent.version)) };
}

/** Explicit adoption preserves messages; it never changes an existing conversation silently. */
export function adoptBotConfiguration(ws: Workspace, chatId: string): Workspace {
  const chat = ws.chats.find((row) => row.id === chatId);
  const agent = ws.agents.find((row) => row.id === chat?.agentId && !row.archived);
  if (!chat || !agent) return ws;
  const model = normalizeBotModel(agent);
  const knowledge = normalizeBotKnowledge(agent.knowledge).knowledge;
  return { ...ws, chats: ws.chats.map((row) => row.id === chatId ? { ...row, botRevision: agent.version,
    botKnowledge: knowledge || undefined, botProvider: model.chatProvider ?? undefined, botTier: model.chatTier ?? undefined,
    customPersonality: normalizeCustomPersonality(agent.instructions), personalityId: "custom", memory: agent.memory, autonomy: agent.approval, projectId: agent.projectId } : row) };
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
