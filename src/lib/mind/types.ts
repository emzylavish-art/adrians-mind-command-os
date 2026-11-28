import type { RequestedReasoningEffort } from "./model-tiers.ts";
import type { PdfEvidenceIndex } from "./pdf-evidence.ts";
import type { ExecutionEvidence } from "./execution-evidence.ts";
import type { SkillApplicationReceipt } from "./skill-activation";
import type { VoiceStagesReceipt } from "./voice/stage-receipts.ts";
import type { ImagePreparationReceipt, ImageEditLineage } from "./media/image-metadata.ts";
import type { ConsultEvidence, HelperReceipt, ConsultAttempt } from "./model-consult.ts";
import type { PersonalityId } from "./personalities/index.ts";
import type { BotModel } from "./bot-model.ts";
import type { ModelTier } from "./model-tiers.ts";
import type { ContextReceipt, ConversationCheckpoint } from "./conversation-context.ts";

import type {
  AgentDefinition,
  AgentRun,
  BrowserSessionRecord,
  DeploymentRecord,
  FleetPin,
  MailboxAccount,
  ProviderConnection,
  RunEvent,
  ScheduleJob,
} from "./fleet";

export type { AgentDefinition, AgentRun, BrowserSessionRecord, DeploymentRecord, FleetPin, MailboxAccount, ProviderConnection, RunEvent, ScheduleJob };

export type Autonomy = "ask" | "automatic";

export type MsgImage = {
  preparation?: ImagePreparationReceipt;
  lineage?: ImageEditLineage;
  origin?: "attached" | "camera" | "generated" | "edited";
  /** Inline data URL when hydrated for display/send. May be omitted in persisted JSON when blobId is set. */
  dataUrl?: string;
  /** IndexedDB (or other blob store) key for large image bytes. Backward compatible with inline-only messages. */
  blobId?: string;
  name?: string;
  mime?: string;
  assetId?: string;
  parentAssetId?: string;
  operationId?: string;
  createdAt?: string;
  editPrompt?: string;
  preferred?: boolean;
};

export type Msg = {
  /** Stable identity of a reviewed image generation; independent of text-turn delivery. */
  mediaOperationId?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  model?: string;
  provider?: string;
  requestedModel?: string;
  routingMode?: "A" | "B" | "C" | "D";
  deliveryOperationId?: string;
  deliveryRoute?: { provider: string; tier: ModelTier; model: string | null; orchestrated: boolean; fingerprint: string };
  delivery?: "submitted" | "unconfirmed" | "stopped" | "failed";
  /** Received but unfinished output. Never included as a completed model-history turn. */
  partialReply?: string;
  inheritedFrom?: { chatId: string; messageId: string };
  workflowKind?: import("./workflow-skills.ts").WorkflowKind;
  skillReceipts?: SkillApplicationReceipt[];
  voiceStages?: VoiceStagesReceipt;
  researchRefs?: { reportId: string; version: number; question: string; at: string }[];
  replyVersions?: ReplyVersion[];
  selectedReplyVersionId?: string;
  memoryUsedIds?: string[];
  consultation?: ConsultEvidence[];
  deliveryMode?: "streamed" | "buffered";
  contextReceipt?: ContextReceipt | { availableMessages: number; includedMessages: number; omittedMessages: number; imageWarnings: string[] };
  requestedReasoningEffort?: RequestedReasoningEffort;
  resolvedTier?: Exclude<ModelTier, "Auto">;
  kind?: "error";
  /** Inline image attachments shown in the bubble and sent on the originating turn. */
  images?: MsgImage[];
  /** Set when this assistant turn's SSE done reported a real memory save. */
  memorySaved?: boolean;
  savedMemoryId?: string | null;
  /** Temporary https link returned by the video service. */
  videoUrl?: string;
  helperReceipts?: HelperReceipt[];
  executionId?: string;
  executionEvidence?: ExecutionEvidence;
  videoOperationId?: string;
  videoRetention?: "provider-temporary" | "local-download" | "account-storage";
  videoExpiresAt?: string | null;
  consult?: ConsultAttempt[];
  replyStatus?: "streaming" | "interrupted" | "complete";
  replyOperationId?: string;
  contextNotice?: string;
};

export type ReplyVersion = { id: string; content: string; at: string; provider?: string; model?: string; requestedModel?: string; routingMode?: Msg["routingMode"]; memoryUsedIds?: string[]; images?: MsgImage[]; videoUrl?: string };

export type Retrieval = { at: string; ids: string[] };

/** Independent context controls. Missing legacy fields retain their documented defaults. */
export type ChatContextPolicy = {
  history?: boolean;
  botKnowledge?: boolean;
  projectDocuments?: boolean;
  projectConversations?: boolean;
  research?: boolean;
  saveMemories?: boolean;
};

export type Chat = {
  /** Metadata revision, independent of the most recent message. */
  updatedAt?: string;
  botConfigVersion?: number;
  forkedFrom?: { chatId: string; messageId: string; at: string };
  notionWorkspaceId?: string;
  id: string;
  agentId?: string;
  botProvider?: NonNullable<BotModel["chatProvider"]>;
  botTier?: ModelTier;
  botExactModel?: string;
  botKnowledge?: string;
  title: string;
  memory: "off" | "on";
  /** Retained preference when temporary-session policy forces effective memory off. */
  requestedMemory?: "off" | "on";
  temporary: boolean;
  autonomy: Autonomy;
  personalityId?: PersonalityId;
  /** Preserved import warning until the owner explicitly chooses a supported style. */
  personalityFallback?: string;
  customPersonalityTruncated?: boolean;
  customPersonality?: string;
  projectId: string | null;
  messages: Msg[];
  retrievalLog: Retrieval[];
  checkpoints?: ConversationCheckpoint[];
  knowledgeDocumentIds?: string[];
  favorite?: boolean;
  archived?: boolean;
  /** Independent quoted copy; deleting its source does not delete this conversation. */
  quotedFrom?: { chatId: string; messageIds: string[]; quotedAt: string };
  branchFrom?: { chatId: string; messageId: string; createdAt: string; sourceRevision: string; reason: "edit" };
  botRevision?: number;
  documentSources?: { fileId: string; revision: string; name: string; messageId?: string }[];
  contextPolicy?: ChatContextPolicy;
};

export type MemoryScope = "global" | "project" | "chat";

export type MemoryVersion = { at: string; text: string };

export type MemoryItem = {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  chatId: string | null;
  text: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  versions: MemoryVersion[];
  alwaysApply?: boolean;
  authority?: "owner-approved" | "unreviewed" | "historical";
  tags?: string[];
  reviewAt?: string;
  supersedesIds?: string[];
  sourceRef?: { documentId?: string; section?: string; url?: string; quote?: string };
  reviewReason?: string;
};

export type ProjectTask = { id: string; title: string; status: "todo" | "doing" | "done"; dependsOn: string[]; updatedAt: string };
export type ProjectEvent = { id: string; at: string; detail: string };

export type Project = {
  lifecycle?: "active" | "paused" | "completed" | "archived";
  instructions?: string;
  tasks?: ProjectTask[];
  events?: ProjectEvent[];
  omittedEvents?: number;
  updatedAt?: string;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  archived?: boolean;
};

export type UsageEntry = {
  executionId?: string;
  id: string;
  operationId?: string;
  channel?: "chat" | "orchestrator" | "speak" | "build" | "image" | "agent";
  stage?: string;
  outcome?: "unconfirmed" | "rejected_before_dispatch" | "completed" | "failed" | "canceled" | "stopped" | "unknown";
  dispatched?: boolean;
  /** Runtime progress is separate from evidence that a provider answered. */
  executionState?: "queued" | "running" | "completed" | "failed" | "canceled";
  providerDispatch?: "not_sent" | "sent" | "unknown";
  chatId: string;
  at: string;
  provider?: string;
  requestedModel?: string;
  model: string;
  requestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  kind: "actual" | "partial" | "unknown";
  role?: "primary" | "helper";
  executionLocation?: "local" | "hosted";
};

export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  target: string;
  /** All resources in a bulk operation, without their deleted content. */
  targetIds?: string[];
  result: string;
};

export type LocalFileOriginal = { blobId: string; sha256: string; bytes: number; mime: string; name: string };
export type BrowserDocumentOriginal = { id: string; sha256: string; bytes: number; mime: string; storage: "browser" };
export type DocumentOriginal = LocalFileOriginal | BrowserDocumentOriginal;
export type DocumentExtraction = string | { method: "plain-text" | "pdf-text" | "legacy"; extractedCharacters: number; retainedCharacters: number; coverage: string; at: string };
export type LocalFileVersion = { versionId: string; name: string; text: string; bytes: number; at: string; original?: DocumentOriginal; partial?: boolean; extraction?: DocumentExtraction };

export type LocalFile = {
  evidenceIndex?: PdfEvidenceIndex;
  id: string;
  name: string;
  text: string;
  bytes: number;
  partial?: boolean;
  original?: DocumentOriginal;
  versionId?: string;
  versions?: LocalFileVersion[];
  updatedAt?: string;
  extraction?: DocumentExtraction;
  sourceChatId?: string;
  sourceMessageId?: string;
  projectId: string | null;
  createdAt: string;
  textSha256?: string;
  revision?: number;
  previousVersionId?: string;
  archived?: boolean;
  retrievalDisabled?: boolean;
  document?: { kind: "pdf"; pages: number; coverage: string; partial: boolean; chunks: import("./pdf-text.ts").PdfChunk[] };
};

export type Workspace = {
  recovery?: RecoveryRecord[];
  version: 1;
  halted: boolean;
  chats: Chat[];
  memories: MemoryItem[];
  deletedMemoryIds?: string[];
  /** Deletions survive stale snapshots and ordinary archive merges. */
  deletedChatIds?: string[];
  projects: Project[];
  files: LocalFile[];
  usage: UsageEntry[];
  audit: AuditEntry[];
  agents: AgentDefinition[];
  deployments: DeploymentRecord[];
  runs: AgentRun[];
  runEvents: RunEvent[];
  connections: ProviderConnection[];
  mailboxes: MailboxAccount[];
  schedules: ScheduleJob[];
  pins: FleetPin[];
  browserSessions: BrowserSessionRecord[];
  syncConflicts?: WorkspaceConflict[];
  toolPermissions?: Record<string, boolean>;
  deletedFileIds?: string[];
};

export type RecoveryRecord = {
  id: string; at: string; action: string; target: string; message: string;
  state: "open" | "dismissed" | "resolved";
  chatId?: string; workspaceId?: string; operationId?: string;
  text?: string; pageId?: string | null; outcome?: string;
};

/** Both variants of a concurrent edit, preserved until the owner reviews them. */
export type WorkspaceJsonValue = null | boolean | number | string | WorkspaceJsonValue[] | { [key: string]: WorkspaceJsonValue };
export type WorkspaceConflict = {
  id: string;
  collection: string;
  recordId: string;
  field: string;
  local: WorkspaceJsonValue;
  remote: WorkspaceJsonValue;
};

export type MemoryNote = { id: string; text: string; authority?: MemoryItem["authority"]; sourceRef?: MemoryItem["sourceRef"]; alwaysApply?: boolean };
