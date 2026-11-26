import { mergeUsageEntries } from "./usage-ledger.ts";
import { readPdfEvidenceIndex } from "./pdf-evidence.ts";
import { readExecutionEvidence } from "./execution-evidence.ts";
import { normalizeSkillReceipts } from "./skill-activation.ts";
import { normalizeVoiceStagesReceipt } from "./voice/stage-receipts.ts";
import { imageMetadata } from "./media/image-metadata.ts";
import { normalizeProjectDetails } from "./project-workspace.ts";
import { normalizeCheckpoints, normalizeContextReceipt } from "./conversation-context.ts";
import { normalizeMemoryMetadata } from "./memory/maintenance.ts";
import { normalizeConsultation, normalizeConsultAttempts } from "./model-consult.ts";
import { workspaceArchiveManifest } from "./workspace-archive-manifest.ts";
import { retainActivity } from "./connection-attention.ts";
import { normalizeRecovery } from "./recovery-inbox.ts";
import { isModelTier, isConnectedGrokModel } from "./model-tiers.ts";
import { emptyFleet, readFleet } from "./fleet.ts";
import { normalizeBotModel } from "./bot-model.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import { effectiveContextPolicy, normalizeContextPolicy } from "./memory/context-policy.ts";
import { MAX_DOCUMENT_TEXT_CHARS, MAX_LIBRARY_FILES } from "./knowledge-limits.ts";
import { DEFAULT_PERSONALITY_ID, isPersonalityId, normalizeCustomPersonality, resolvePersonalityId } from "./personalities/index.ts";
import { attachmentIssues, attachmentManifest } from "./media/attachment-integrity.ts";
import type {
  AuditEntry,
  Autonomy,
  Chat,
  LocalFile,
  DocumentOriginal,
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
  const raw = readWorkspaceRawForAccount(storage, userId, verifiedEmail);
  if (!raw) return emptyWorkspace();
  try {
    return normalizeWorkspace(JSON.parse(raw));
  } catch {
    return emptyWorkspace();
  }
}

/** Read the complete authorized snapshot bytes without parsing on the UI thread. */
export function readWorkspaceRawForAccount(storage: Pick<Storage, "getItem">, userId: string | null | undefined, verifiedEmail?: string | null): string | null {
  if (!userId) return null;
  const current = storage.getItem(accountWorkspaceKey(userId));
  return current ?? (userId !== "dev-user" && isPrimaryOwner(verifiedEmail) ? storage.getItem(WORKSPACE_KEY) : null);
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
    if (item.archived || item.reviewReason) return false;
    if (item.scope === "global") return true;
    if (item.scope === "project") return !!chat.projectId && ws.projects.some((project) => project.id === chat.projectId) && item.projectId === chat.projectId;
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
  if (Array.isArray(input.recovery)) base.recovery = normalizeRecovery(input.recovery);
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
        ...normalizeProjectDetails(row),
        id: str(row.id),
        name: str(row.name).slice(0, PROJECT_NAME_MAX),
        description: str(row.description).slice(0, 400),
        createdAt: str(row.createdAt, new Date(0).toISOString()),
        ...(row.archived === true ? { archived: true } : {}),
      });
    }
  }
  const deletedChats = new Set(validIds(input.deletedChatIds));
  if (deletedChats.size) base.deletedChatIds = [...deletedChats];
  if (Array.isArray(input.chats)) {
    for (const row of input.chats) {
      const chat = normalizeChat(row);
      if (chat && !deletedChats.has(chat.id)) base.chats.push(chat);
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
  const deletedFiles = new Set(validIds(input.deletedFileIds));
  if (deletedFiles.size) base.deletedFileIds = [...deletedFiles];
  if (Array.isArray(input.files)) {
    for (const row of input.files) {
      const file = normalizeFile(row);
      if (file && !deletedFiles.has(file.id)) base.files.push(file);
    }
  }
  if (Array.isArray(input.usage)) {
    for (const row of input.usage) {
      if (!isRecord(row) || !str(row.id)) continue;
      const promptTokens = typeof row.promptTokens === "number" && Number.isSafeInteger(row.promptTokens) && row.promptTokens >= 0 ? row.promptTokens : null;
      const completionTokens = typeof row.completionTokens === "number" && Number.isSafeInteger(row.completionTokens) && row.completionTokens >= 0 ? row.completionTokens : null;
      base.usage.push({
        ...(typeof row.executionId === "string" && row.executionId.length <= 200 ? { executionId: row.executionId } : {}),
        id: str(row.id),
        chatId: str(row.chatId),
        at: str(row.at),
        ...(typeof row.operationId === "string" ? { operationId: row.operationId } : {}),
        ...(["chat", "orchestrator", "speak", "build", "image", "agent"].includes(String(row.channel)) ? { channel: row.channel as UsageEntry["channel"] } : {}),
        ...(typeof row.stage === "string" ? { stage: row.stage } : {}),
        ...(["unconfirmed", "rejected_before_dispatch", "completed", "failed", "canceled"].includes(String(row.outcome)) ? { outcome: row.outcome as UsageEntry["outcome"] } : {}),
        ...(typeof row.dispatched === "boolean" ? { dispatched: row.dispatched } : {}),
        ...(["queued", "running", "completed", "failed", "canceled"].includes(String(row.executionState)) ? { executionState: row.executionState as UsageEntry["executionState"] } : {}),
        ...(["not_sent", "sent", "unknown"].includes(String(row.providerDispatch)) ? { providerDispatch: row.providerDispatch as UsageEntry["providerDispatch"] } : {}),
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
        ...(validIds(row.targetIds).length ? { targetIds: validIds(row.targetIds) } : {}),
        result: str(row.result),
      });
    }
  }
  return { ...base, ...readFleet(input) };
}

function normalizeChat(row: unknown): Chat | null {
  if (!isRecord(row) || !str(row.id)) return null;
  const memory = row.memory === "on" && row.temporary !== true ? "on" : "off";
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
        ...(recovery ? { deliveryRoute: recovery } : {}),
        id: str(msg.id, crypto.randomUUID()),
        role: msg.role,
        content: msg.content,
        at: str(msg.at, new Date(0).toISOString()),
        model: typeof msg.model === "string" ? msg.model : undefined,
        ...(isModelTier(msg.resolvedTier) && msg.resolvedTier !== "Auto" ? { resolvedTier: msg.resolvedTier } : {}),
        ...(normalizeContextReceipt(msg.contextReceipt) ? { contextReceipt: normalizeContextReceipt(msg.contextReceipt)! } : {}),
        ...(normalizeSkillReceipts(msg.skillReceipts) ? { skillReceipts: normalizeSkillReceipts(msg.skillReceipts)! } : {}),
        ...(normalizeVoiceStagesReceipt(msg.voiceStages) ? { voiceStages: normalizeVoiceStagesReceipt(msg.voiceStages)! } : {}),
        ...(normalizeConsultation(msg.consultation) ? { consultation: normalizeConsultation(msg.consultation)! } : {}),
        ...(msg.deliveryMode === "streamed" || msg.deliveryMode === "buffered" ? { deliveryMode: msg.deliveryMode } : {}),
        ...(typeof msg.provider === "string" && msg.provider.trim() ? { provider: msg.provider.trim() } : {}),
        ...(Array.isArray(msg.consult) ? { consult: normalizeConsultAttempts(msg.consult) } : {}),
        ...(isRecord(msg.contextReceipt) && typeof msg.contextReceipt.availableMessages === "number" && !("version" in msg.contextReceipt) ? { contextReceipt: { availableMessages: Number(msg.contextReceipt.availableMessages) || 0, includedMessages: Number(msg.contextReceipt.includedMessages) || 0, omittedMessages: Number(msg.contextReceipt.omittedMessages) || 0, imageWarnings: Array.isArray(msg.contextReceipt.imageWarnings) ? msg.contextReceipt.imageWarnings.filter((value): value is string => typeof value === "string").slice(0, 12) : [] } } : {}),
        ...(msg.routingMode === "A" || msg.routingMode === "B" || msg.routingMode === "C" || msg.routingMode === "D" ? { routingMode: msg.routingMode } : {}),
        ...(typeof msg.requestedModel === "string" && msg.requestedModel.trim() ? { requestedModel: msg.requestedModel.trim().slice(0, 150) } : {}),
        ...(Array.isArray(msg.researchRefs) ? { researchRefs: msg.researchRefs.flatMap((reference) => {
          if (!isRecord(reference) || !str(reference.reportId) || !Number.isSafeInteger(reference.version) || Number(reference.version) < 1) return [];
          return [{ reportId: str(reference.reportId).slice(0, 200), version: Number(reference.version), question: str(reference.question).slice(0, 300), at: str(reference.at) }];
        }) } : {}),
        ...(isRecord(msg.inheritedFrom) && str(msg.inheritedFrom.chatId) && str(msg.inheritedFrom.messageId) ? { inheritedFrom: { chatId: str(msg.inheritedFrom.chatId).slice(0, 200), messageId: str(msg.inheritedFrom.messageId).slice(0, 200) } } : {}),
        ...(msg.role === "assistant" && Array.isArray(msg.replyVersions) ? { replyVersions: msg.replyVersions.flatMap((version) => {
          if (!isRecord(version) || !str(version.id) || typeof version.content !== "string") return [];
          return [{ id: str(version.id).slice(0, 200), content: version.content, at: str(version.at),
            ...(typeof version.provider === "string" ? { provider: version.provider } : {}),
            ...(typeof version.model === "string" ? { model: version.model } : {}),
            ...(typeof version.requestedModel === "string" ? { requestedModel: version.requestedModel } : {}),
            ...(version.routingMode === "A" || version.routingMode === "B" || version.routingMode === "C" || version.routingMode === "D" ? { routingMode: version.routingMode as Msg["routingMode"] } : {}),
            ...(validIds(version.memoryUsedIds).length ? { memoryUsedIds: validIds(version.memoryUsedIds) } : {}),
            ...publicImages(version.images), ...publicVideo(version.videoUrl) }];
        }), ...(typeof msg.selectedReplyVersionId === "string" ? { selectedReplyVersionId: msg.selectedReplyVersionId } : {}) } : {}),
        ...(msg.role === "user" && typeof msg.partialReply === "string" && msg.partialReply ? { partialReply: msg.partialReply.slice(0, 100_000) } : {}),
        ...(validIds(msg.memoryUsedIds).length ? { memoryUsedIds: validIds(msg.memoryUsedIds) } : {}),
        ...(msg.role === "assistant" && msg.kind === "error" ? { kind: "error" as const } : {}),
        ...(typeof msg.mediaOperationId === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(msg.mediaOperationId) ? { mediaOperationId: msg.mediaOperationId } : {}),
        ...(msg.role === "user" && typeof msg.deliveryOperationId === "string" && /^\d{13}-[a-f0-9-]{36}$/i.test(msg.deliveryOperationId) ? { deliveryOperationId: msg.deliveryOperationId } : {}),
        ...(msg.role === "user" && (msg.delivery === "submitted" || msg.delivery === "unconfirmed" || msg.delivery === "stopped" || msg.delivery === "failed") ? { delivery: msg.delivery } : {}),
        ...(msg.replyStatus === "streaming" || msg.replyStatus === "interrupted" || msg.replyStatus === "complete" ? { replyStatus: msg.replyStatus } : {}),
        ...(typeof msg.replyOperationId === "string" ? { replyOperationId: msg.replyOperationId.slice(0, 120) } : {}),
        ...(typeof msg.contextNotice === "string" ? { contextNotice: msg.contextNotice.slice(0, 2000) } : {}),
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
    ...(typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt)) ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.botConfigVersion === "number" && Number.isSafeInteger(row.botConfigVersion) ? { botConfigVersion: row.botConfigVersion } : {}),
    ...(isRecord(row.forkedFrom) && typeof row.forkedFrom.chatId === "string" && typeof row.forkedFrom.messageId === "string" && typeof row.forkedFrom.at === "string" ? { forkedFrom: { chatId: row.forkedFrom.chatId, messageId: row.forkedFrom.messageId, at: row.forkedFrom.at } } : {}),
    title: str(row.title, "New session").slice(0, 80),
    ...(isRecord(row.branchFrom) && str(row.branchFrom.chatId) && str(row.branchFrom.messageId) && /^[a-f0-9]{64}$/.test(str(row.branchFrom.sourceRevision)) ? {
      branchFrom: { chatId: str(row.branchFrom.chatId).slice(0, 200), messageId: str(row.branchFrom.messageId).slice(0, 200), createdAt: str(row.branchFrom.createdAt), sourceRevision: str(row.branchFrom.sourceRevision), reason: "edit" as const },
    } : {}),
    ...(isRecord(row.quotedFrom) && str(row.quotedFrom.chatId) ? {
      quotedFrom: { chatId: str(row.quotedFrom.chatId).slice(0, 200), messageIds: validIds(row.quotedFrom.messageIds), quotedAt: str(row.quotedFrom.quotedAt) },
    } : {}),
    ...(typeof row.notionWorkspaceId === "string" && row.notionWorkspaceId.length <= 200 ? { notionWorkspaceId: row.notionWorkspaceId } : {}),
    ...(typeof row.agentId === "string" && row.agentId ? { agentId: row.agentId } : {}),
    ...(typeof row.botRevision === "number" && Number.isSafeInteger(row.botRevision) ? { botRevision: row.botRevision } : {}),
    ...(Array.isArray(row.documentSources) ? { documentSources: row.documentSources.filter((item) => isRecord(item) && typeof item.fileId === "string" && typeof item.revision === "string" && typeof item.name === "string").map((item) => ({ fileId: String(item.fileId), revision: String(item.revision), name: String(item.name), ...(typeof item.messageId === "string" ? { messageId: item.messageId } : {}) })) } : {}),
    ...chatBotModel(row),
    ...(normalizeContextPolicy(row.contextPolicy) ? { contextPolicy: normalizeContextPolicy(row.contextPolicy) } : {}),
    ...(isConnectedGrokModel(row.botExactModel) ? { botExactModel: row.botExactModel } : {}),
    memory,
    ...(row.temporary === true ? { requestedMemory: row.requestedMemory === "on" || (row.requestedMemory === undefined && row.memory === "on") ? "on" as const : "off" as const } : {}),
    temporary: row.temporary === true,
    autonomy,
    personalityId: resolvePersonalityId(row.personalityId),
    ...(typeof row.personalityId === "string" && !isPersonalityId(row.personalityId)
      ? { personalityFallback: row.personalityId.slice(0, 80) }
      : typeof row.personalityFallback === "string" ? { personalityFallback: row.personalityFallback.slice(0, 80) } : {}),
    ...(row.customPersonalityTruncated === true || typeof row.customPersonality === "string" && row.customPersonality.length > 800 ? { customPersonalityTruncated: true } : {}),
    customPersonality: typeof row.customPersonality === "string" ? row.customPersonality.slice(0, 800) : "",
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    messages,
    retrievalLog,
    ...(normalizeCheckpoints(row.checkpoints, new Set(messages.map((message) => message.id))).length ? { checkpoints: normalizeCheckpoints(row.checkpoints, new Set(messages.map((message) => message.id))) } : {}),
    ...(validIds(row.knowledgeDocumentIds).length ? { knowledgeDocumentIds: validIds(row.knowledgeDocumentIds).slice(0, 100) } : {}),
    ...(row.favorite === true ? { favorite: true as const } : {}),
    ...(row.archived === true ? { archived: true as const } : {}),
  };
}

function normalizeFile(row: unknown): LocalFile | null {
  if (!isRecord(row) || !str(row.id) || typeof row.text !== "string" || (!row.text.trim() && !normalizeOriginal(row.original))) return null;
  const text = row.text.slice(0, MAX_DOCUMENT_TEXT_CHARS);
  const evidenceIndex = readPdfEvidenceIndex(row.evidenceIndex, text.length);
  return {
    id: str(row.id),
    name: str(row.name, "untitled.txt"),
    ...(evidenceIndex ? { evidenceIndex } : {}),
    ...(row.text.length === text.length && typeof row.textSha256 === "string" && /^[a-f0-9]{64}$/.test(row.textSha256) ? { textSha256: row.textSha256 } : {}),
    ...(Number.isSafeInteger(row.revision) && Number(row.revision) > 0 ? { revision: Number(row.revision) } : {}),
    ...(typeof row.previousVersionId === "string" ? { previousVersionId: row.previousVersionId } : {}),
    ...(row.archived === true ? { archived: true } : {}),
    ...(row.retrievalDisabled === true ? { retrievalDisabled: true } : {}),
    ...(normalizeOriginal(row.original) ? { original: normalizeOriginal(row.original)! } : {}),
    ...(str(row.versionId) ? { versionId: str(row.versionId).slice(0, 200) } : {}),
    ...(str(row.updatedAt) ? { updatedAt: str(row.updatedAt) } : {}),
    ...extractionMetadata(row.extraction),
    ...(str(row.sourceChatId) ? { sourceChatId: str(row.sourceChatId).slice(0, 200) } : {}),
    ...(str(row.sourceMessageId) ? { sourceMessageId: str(row.sourceMessageId).slice(0, 200) } : {}),
    ...(Array.isArray(row.versions) ? { versions: row.versions.flatMap((version) => {
      if (!isRecord(version) || !str(version.versionId) || typeof version.text !== "string") return [];
      return [{ versionId: str(version.versionId).slice(0, 200), name: str(version.name), text: version.text.slice(0, MAX_DOCUMENT_TEXT_CHARS), bytes: typeof version.bytes === "number" ? version.bytes : version.text.length, at: str(version.at),
        ...(normalizeOriginal(version.original) ? { original: normalizeOriginal(version.original)! } : {}), ...(version.partial === true || version.text.length > MAX_DOCUMENT_TEXT_CHARS ? { partial: true } : {}), ...extractionMetadata(version.extraction) }];
    }) } : {}),
    text,
    bytes: typeof row.bytes === "number" ? row.bytes : text.length,
    ...(row.partial === true || row.text.length > text.length ? { partial: true } : {}),
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    createdAt: str(row.createdAt, new Date(0).toISOString()),
    ...(normalizeDocument(row.document) ? { document: normalizeDocument(row.document)! } : {}),
  };
}

function normalizeDocument(value: unknown): LocalFile["document"] {
  if (!isRecord(value) || value.kind !== "pdf" || !Array.isArray(value.chunks)) return undefined;
  const chunks = value.chunks.slice(0, 200).flatMap((chunk) => {
    if (!isRecord(chunk) || typeof chunk.text !== "string" || typeof chunk.id !== "string") return [];
    return [{ id: chunk.id.slice(0, 100), page: typeof chunk.page === "number" && chunk.page > 0 ? chunk.page : null,
      start: Math.max(0, Number(chunk.start) || 0), end: Math.max(0, Number(chunk.end) || 0), text: chunk.text.slice(0, 2000) }];
  });
  return { kind: "pdf", pages: Math.max(0, Number(value.pages) || 0), coverage: str(value.coverage).slice(0, 2000), partial: value.partial === true, chunks };
}

function extractionMetadata(value: unknown): Pick<LocalFile, "extraction"> {
  if (typeof value === "string" && value) return { extraction: value.slice(0, 1000) };
  if (!isRecord(value)) return {};
  const { method, extractedCharacters, retainedCharacters } = value;
  if (method !== "plain-text" && method !== "pdf-text" && method !== "legacy") return {};
  if (typeof extractedCharacters !== "number" || !Number.isSafeInteger(extractedCharacters) || extractedCharacters < 0 ||
      typeof retainedCharacters !== "number" || !Number.isSafeInteger(retainedCharacters) || retainedCharacters < 0 || retainedCharacters > extractedCharacters) return {};
  return { extraction: { method, extractedCharacters, retainedCharacters, coverage: str(value.coverage).slice(0, 2000), at: str(value.at) } };
}

function normalizeOriginal(value: unknown): DocumentOriginal | null {
  if (isRecord(value) && value.storage === "browser" && typeof value.id === "string" && value.id && value.id.length <= 200 &&
      /^[a-f0-9]{64}$/.test(str(value.sha256)) && Number.isSafeInteger(value.bytes) && Number(value.bytes) >= 0) {
    return { id: value.id, storage: "browser", sha256: str(value.sha256), bytes: Number(value.bytes), mime: str(value.mime, "application/octet-stream") };
  }
  if (!isRecord(value) || !/^document_[a-f0-9]{64}$/.test(str(value.blobId)) || !/^[a-f0-9]{64}$/.test(str(value.sha256)) || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0) return null;
  return { blobId: str(value.blobId), sha256: str(value.sha256), bytes: Number(value.bytes), mime: str(value.mime, "application/octet-stream").slice(0, 100), name: str(value.name).slice(0, 1000) };
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
      ...Object.fromEntries(["assetId", "parentAssetId", "operationId", "createdAt"].filter((key) => typeof item[key] === "string" && (item[key] as string).length > 0 && (item[key] as string).length <= 200).map((key) => [key, item[key]])),
      ...(typeof item.editPrompt === "string" ? { editPrompt: item.editPrompt.slice(0, 6000) } : {}),
      ...(typeof item.preferred === "boolean" ? { preferred: item.preferred } : {}),
      dataUrl,
      blobId,
      ...imageMetadata(item),
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
    ...normalizeMemoryMetadata(row),
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
    updatedAt: new Date().toISOString(),
    title: "New session",
    memory: input.temporary ? "off" : input.memory,
    ...(input.temporary ? { requestedMemory: input.memory } : {}),
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
  const linked = { ...chat, title: agent.name, agentId, botRevision: agent.version, botConfigVersion: agent.version };
  if (agent.knowledgeDocumentIds?.length) linked.knowledgeDocumentIds = [...agent.knowledgeDocumentIds];
  const model = normalizeBotModel(agent);
  if (model.chatProvider) linked.botProvider = model.chatProvider;
  if (model.chatTier) linked.botTier = model.chatTier;
  const knowledge = normalizeBotKnowledge(agent.knowledge).knowledge;
  if (knowledge) linked.botKnowledge = knowledge;
  return { ws: { ...ws, chats: [linked, ...ws.chats] }, chat: linked };
}

/** A running conversation remains pinned until its owner explicitly refreshes it. */
export function refreshBotChat(ws: Workspace, chatId: string): Workspace {
  const chat = ws.chats.find((item) => item.id === chatId);
  const agent = ws.agents.find((item) => item.id === chat?.agentId && !item.archived);
  if (!chat || !agent) return ws;
  const model = normalizeBotModel(agent);
  return { ...ws, chats: ws.chats.map((item) => item.id !== chatId ? item : {
    ...item, memory: agent.memory, autonomy: agent.approval,
    projectId: ws.projects.some((project) => project.id === agent.projectId) ? agent.projectId : null,
    personalityId: "custom", customPersonality: normalizeCustomPersonality(agent.instructions),
    botKnowledge: normalizeBotKnowledge(agent.knowledge).knowledge,
    botProvider: model.chatProvider ?? undefined, botTier: model.chatTier ?? undefined,
    botRevision: agent.version, botConfigVersion: agent.version, updatedAt: new Date().toISOString(),
  }) };
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
    chats: ws.chats.map((chat) => chat.id === chatId ? { ...chat, personalityId: next, personalityFallback: undefined } : chat),
  };
}

export function updateChatCustomPersonality(ws: Workspace, chatId: string, customPersonality: unknown): Workspace {
  const next = typeof customPersonality === "string" ? customPersonality.slice(0, 800) : "";
  if (!chatId || !ws.chats.some((chat) => chat.id === chatId)) return ws;
  return {
    ...ws,
    chats: ws.chats.map((chat) => chat.id === chatId ? { ...chat, customPersonality: next, customPersonalityTruncated: typeof customPersonality === "string" && customPersonality.length > 800 ? true : undefined } : chat),
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

/** Exclude known resources belonging to temporary chats without deleting unrelated saved data. */
export function archiveWorkspace(ws: Workspace, includeTemporary: boolean): Workspace {
  if (includeTemporary) return normalizeWorkspace(ws);
  const excluded = new Set(ws.chats.filter((chat) => chat.temporary).map((chat) => chat.id));
  return normalizeWorkspace({
    ...ws,
    chats: ws.chats.filter((chat) => !chat.temporary),
    memories: ws.memories.filter((note) => !note.chatId || !excluded.has(note.chatId)),
    files: ws.files.filter((file) => !file.sourceChatId || !excluded.has(file.sourceChatId)),
    usage: ws.usage.filter((entry) => !excluded.has(entry.chatId)),
    audit: ws.audit.filter((entry) => !excluded.has(entry.target) && !entry.targetIds?.some((id) => excluded.has(id))),
    schedules: ws.schedules.filter((job) => !job.chatId || !excluded.has(job.chatId)),
    pins: ws.pins.filter((pin) => pin.kind !== "chat" || !excluded.has(pin.ref)),
  });
}

export async function packWorkspace(ws: Workspace, includeTemporary: boolean) {
  const workspace = archiveWorkspace(ws, includeTemporary);
  return {
    product: "adrians-mind" as const,
    format: 1 as const,
    sha256: await sha256(canonical(workspace)),
    counts: counts(workspace),
    manifest: workspaceArchiveManifest(workspace, { omittedTemporaryChats: includeTemporary ? 0 : ws.chats.filter((chat) => chat.temporary).length }),
    attachments: attachmentManifest(workspace),
    resources: {
      extractedDocuments: workspace.files.map((file) => ({ id: file.id, name: file.name, partial: file.partial === true, revision: file.textSha256 ?? null })),
      excludedOriginals: workspace.files.filter((file) => file.original || file.versions?.some((version) => version.original)).map((file) => ({ fileId: file.id, name: file.name, reason: "Original bytes are stored on the originating browser and are not embedded in this JSON archive." })),
    },
    originals: { included: false, references: workspace.files.filter((file) => file.original).length, note: "Original documents are saved separately in the originating account on this device. This archive contains references and extracted previews; download originals separately." },
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
  // Verify the original payload before current normalization. Older valid archives
  // can gain new policy defaults without making their integrity hash obsolete.
  const actual = await sha256(canonical(parsed.workspace));
  const workspace = normalizeWorkspace(parsed.workspace);
  if (actual !== parsed.sha256) {
    return { ok: false, error: "Archive hash does not match. Nothing was imported." };
  }
  const attachments = attachmentManifest(workspace);
  const warnings = attachmentIssues(workspace).map((issue) => `${issue.name}: ${issue.reason}`);
  if (!attachments.complete) warnings.unshift(`${attachments.referenced - attachments.included} image attachment(s) have references but no image bytes in this archive. They may be unavailable on another device.`);
  return { ok: true, workspace, counts: counts(workspace), attachments, warnings };
}

function validIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))] : [];
}

/** Retain the first workspace's content while applying deletion knowledge from both copies. */
export function mergeChatDeletionState(current: Workspace, incoming: Workspace): Pick<Workspace, "chats" | "deletedChatIds"> {
  const deleted = new Set([...(current.deletedChatIds ?? []), ...(incoming.deletedChatIds ?? [])]);
  return { chats: current.chats.filter((chat) => !deleted.has(chat.id)), ...(deleted.size ? { deletedChatIds: [...deleted] } : {}) };
}

export function mergeMemoryState(current: Workspace, incoming: Workspace): Pick<Workspace, "memories" | "deletedMemoryIds"> {
  const deleted = new Set([...(current.deletedMemoryIds ?? []), ...(incoming.deletedMemoryIds ?? [])]);
  const memories = new Map<string, MemoryItem>();
  for (const note of [...current.memories, ...incoming.memories]) {
    if (deleted.has(note.id)) continue;
    const previous = memories.get(note.id);
    if (!previous) { memories.set(note.id, note); continue; }
    const winner = note.updatedAt > previous.updatedAt ||
        (note.updatedAt === previous.updatedAt && (note.versions.length > previous.versions.length ||
          (note.versions.length === previous.versions.length && note.archived && !previous.archived))) ? note : previous;
    const history = [...previous.versions, ...note.versions,
      ...(previous.text !== winner.text ? [{ at: previous.updatedAt, text: previous.text }] : []),
      ...(note.text !== winner.text ? [{ at: note.updatedAt, text: note.text }] : [])];
    const versions = [...new Map(history.map((version) => [canonical(version), version])).values()]
      .sort((a, b) => a.at.localeCompare(b.at) || a.text.localeCompare(b.text));
    memories.set(note.id, { ...winner, versions });
  }
  return { memories: [...memories.values()], ...(deleted.size ? { deletedMemoryIds: [...deleted] } : {}) };
}

export const ARCHIVE_CATEGORIES = ["chats", "memories", "projects", "files", "agents", "activity"] as const;
export type ArchiveCategory = typeof ARCHIVE_CATEGORIES[number];

/** A selection is an import payload, never a replacement for unrelated current data. */
export function selectArchiveCategories(archive: Workspace, categories: readonly ArchiveCategory[]): Workspace {
  const selected = new Set(categories);
  const result = emptyWorkspace();
  if (selected.has("chats")) { result.chats = archive.chats; result.deletedChatIds = archive.deletedChatIds; result.pins = archive.pins.filter((pin) => pin.kind === "chat"); }
  if (selected.has("memories")) { result.memories = archive.memories; result.deletedMemoryIds = archive.deletedMemoryIds; }
  if (selected.has("projects")) result.projects = archive.projects;
  if (selected.has("files")) { result.files = archive.files; result.deletedFileIds = archive.deletedFileIds; }
  if (selected.has("agents")) {
    result.agents = archive.agents; result.runs = archive.runs; result.runEvents = archive.runEvents;
    result.schedules = archive.schedules; result.deployments = archive.deployments;
    result.connections = archive.connections; result.mailboxes = archive.mailboxes; result.browserSessions = archive.browserSessions;
  }
  if (selected.has("activity")) { result.usage = archive.usage; result.audit = archive.audit; }
  return result;
}

/** Saved configuration is not current authorization or a live connection. */
function inactiveArchive(archive: Workspace): Workspace {
  return {
    ...archive,
    runs: archive.runs.map((run) => ({ ...run, state: ["completed", "failed", "canceled"].includes(run.state) ? run.state : "paused", workerId: null, leaseUntil: null, approvedActions: [], pendingApproval: undefined })),
    schedules: archive.schedules.map((job) => ({ ...job, enabled: false, resultDelivery: "runs", leaseWorker: null, leaseUntil: null })),
    deployments: archive.deployments.map((row) => ({ ...row, state: "external-required", workerId: null, heartbeatAt: null, error: "Imported configuration. Verify a worker before deployment." })),
    connections: archive.connections.map((row) => ({ ...row, status: "unconfigured", secretStored: false })),
    browserSessions: archive.browserSessions.map((row) => ({ ...row, status: row.status === "failed" ? "failed" : "closed" })),
  };
}

/** Explicit replacement can restore forgotten content only as newly saved notes. */
export function replaceFromArchive(current: Workspace, source: Workspace): Workspace {
  const archive = inactiveArchive(source);
  const deleted = new Set([...(current.deletedMemoryIds ?? []), ...(archive.deletedMemoryIds ?? [])]);
  const deletedFiles = new Set([...(current.deletedFileIds ?? []), ...(archive.deletedFileIds ?? [])]);
  const restoredFiles = new Set(archive.files.map((file) => file.id));
  for (const file of current.files) if (!restoredFiles.has(file.id)) deletedFiles.add(file.id);
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
  const deletedChats = new Set([...(current.deletedChatIds ?? []), ...(archive.deletedChatIds ?? [])]);
  const incomingChats = new Set(archive.chats.map((chat) => chat.id));
  for (const chat of current.chats) if (!incomingChats.has(chat.id)) deletedChats.add(chat.id);
  const restoredIds = new Map<string, string>();
  const chats = archive.chats.map((chat) => {
    if (!deletedChats.has(chat.id)) return chat;
    const id = crypto.randomUUID();
    restoredIds.set(chat.id, id);
    return { ...chat, id };
  });
  return {
    ...archive, chats, files: archive.files.filter((file) => !deletedFiles.has(file.id)),
    ...(deletedFiles.size ? { deletedFileIds: [...deletedFiles] } : {}),
    memories: memories.map((note) => note.chatId && restoredIds.has(note.chatId) ? { ...note, chatId: restoredIds.get(note.chatId)! } : note),
    deletedMemoryIds: [...deleted], ...(deletedChats.size ? { deletedChatIds: [...deletedChats] } : {}),
    pins: archive.pins.map((pin) => pin.kind === "chat" && restoredIds.has(pin.ref) ? { ...pin, ref: restoredIds.get(pin.ref)! } : pin),
    schedules: archive.schedules.map((job) => ({ ...job, enabled: false, leaseWorker: null, leaseUntil: null, ...(job.chatId && restoredIds.has(job.chatId) ? { chatId: restoredIds.get(job.chatId)! } : {}) })),
    halted: current.halted || archive.halted,
  };
}

function restoredRun<T extends Workspace["runs"][number]>(run: T): T {
  return ["queued", "running", "waiting_approval", "waiting_external"].includes(run.state)
    ? { ...run, state: "paused", workerId: null, leaseUntil: null, approvedActions: [], approvals: [] } : run;
}

function newerRecord<T extends { id: string; updatedAt?: string; version?: number }>(current: T, incoming: T): T {
  if (incoming.updatedAt && current.updatedAt && incoming.updatedAt > current.updatedAt) return incoming;
  if (incoming.updatedAt === current.updatedAt && (incoming.version ?? 0) > (current.version ?? 0)) return incoming;
  return current;
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

export function mergeWorkspace(current: Workspace, source: Workspace): Workspace {
  const incoming = inactiveArchive(source);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const merge = <T extends { id: string }>(left: T[], right: T[]) => [...byId([...left, ...right]).values()];
  const deletedFiles = new Set([...(current.deletedFileIds ?? []), ...(incoming.deletedFileIds ?? [])]);
  const archivedChats = byId(incoming.chats);
  const deletionState = mergeChatDeletionState({ ...current, chats: [...byId([...incoming.chats, ...current.chats]).values()] }, incoming);
  return {
    version: 1,
    halted: current.halted,
    ...deletionState,
    chats: deletionState.chats.map((chat) => {
      const archive = archivedChats.get(chat.id);
      if (!archive || archive === chat) return chat;
      const messages = merge(archive.messages, chat.messages).sort((a, b) => a.at.localeCompare(b.at));
      return { ...chat, temporary: chat.temporary || archive.temporary, messages };
    }),
    // Preserve the current resolution when an older archive contains the same operation.
    recovery: normalizeRecovery([...(current.recovery ?? []), ...(incoming.recovery ?? [])]),
    ...mergeMemoryState(current, incoming),
    projects: merge(current.projects, incoming.projects),
    files: merge(incoming.files, current.files).filter((file) => !deletedFiles.has(file.id)),
    ...(deletedFiles.size ? { deletedFileIds: [...deletedFiles] } : {}),
    usage: merge(current.usage, incoming.usage).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    audit: retainActivity(merge(current.audit, incoming.audit).sort((a, b) => b.at.localeCompare(a.at))),
    agents: merge(incoming.agents, current.agents),
    deployments: merge(incoming.deployments, current.deployments),
    runs: merge(incoming.runs, current.runs),
    runEvents: merge(current.runEvents, incoming.runEvents),
    connections: merge(incoming.connections, current.connections),
    mailboxes: merge(incoming.mailboxes, current.mailboxes),
    schedules: merge(incoming.schedules, current.schedules),
    pins: merge(current.pins, incoming.pins),
    browserSessions: merge(incoming.browserSessions, current.browserSessions),
  };
}

export function recordAudit(ws: Workspace, action: string, target: string, result: string, targetIds?: readonly string[]): { ws: Workspace; entry: AuditEntry } {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    target,
    ...(targetIds?.length ? { targetIds: validIds(targetIds) } : {}),
    result,
  };
  return { ws: { ...ws, audit: retainActivity([entry, ...ws.audit]) }, entry };
}

export function pushAudit(ws: Workspace, action: string, target: string, result: string, targetIds?: readonly string[]): Workspace {
  return recordAudit(ws, action, target, result, targetIds).ws;
}

function usageKind(prompt: unknown, completion: unknown): UsageEntry["kind"] {
  const valid = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (valid(prompt) && valid(completion)) return "actual";
  return valid(prompt) || valid(completion) ? "partial" : "unknown";
}

export function pushUsage(ws: Workspace, entry: Omit<UsageEntry, "kind">): Workspace {
  return { ...ws, usage: mergeUsageEntries([{ ...entry, kind: usageKind(entry.promptTokens, entry.completionTokens) }, ...ws.usage]).slice(0, 200) };
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

export function deleteLocalFile(ws: Workspace, id: string): Workspace {
  if (!ws.files.some((file) => file.id === id)) return ws;
  return { ...ws, files: ws.files.filter((file) => file.id !== id), deletedFileIds: [...new Set([...(ws.deletedFileIds ?? []), id])] };
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

/** Metadata edits receive their own clock so archive merge need not infer freshness from messages. */
export function stampWorkspaceEdits(previous: Workspace, next: Workspace, now = new Date().toISOString()): Workspace {
  if (previous === next) return next;
  const oldChats = new Map(previous.chats.map((chat) => [chat.id, chat]));
  return { ...next, chats: next.chats.map((chat) => {
    const old = oldChats.get(chat.id);
    if (!old || old === chat || (chat.updatedAt && chat.updatedAt !== old.updatedAt)) return chat;
    const { messages: _m1, retrievalLog: _r1, updatedAt: _t1, ...before } = old;
    const { messages: _m2, retrievalLog: _r2, updatedAt: _t2, ...after } = chat;
    return canonical(before) === canonical(after) ? chat : { ...chat, updatedAt: now };
  }) };
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
  return { ...ws, chats: ws.chats.map((row) => row.id === chatId ? { ...row, botRevision: agent.version, botConfigVersion: agent.version,
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
