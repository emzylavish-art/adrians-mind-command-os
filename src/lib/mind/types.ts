import type { SkillApplicationReceipt } from "./skill-activation";
import type { VoiceStagesReceipt } from "./voice/stage-receipts.ts";
import type { ImagePreparationReceipt, ImageEditLineage } from "./media/image-metadata.ts";
import type { ConsultEvidence } from "./model-consult.ts";
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
  skillReceipts?: SkillApplicationReceipt[];
  voiceStages?: VoiceStagesReceipt;
  researchRefs?: { reportId: string; version: number; question: string; at: string }[];
  replyVersions?: ReplyVersion[];
  selectedReplyVersionId?: string;
  memoryUsedIds?: string[];
  consultation?: ConsultEvidence[];
  deliveryMode?: "streamed" | "buffered";
  contextReceipt?: ContextReceipt;
  resolvedTier?: Exclude<ModelTier, "Auto">;
  kind?: "error";
  /** Inline image attachments shown in the bubble and sent on the originating turn. */
  images?: MsgImage[];
  /** Set when this assistant turn's SSE done reported a real memory save. */
  memorySaved?: boolean;
  savedMemoryId?: string | null;
  /** Temporary https link returned by the video service. */
  videoUrl?: string;
};

export type ReplyVersion = { id: string; content: string; at: string; provider?: string; model?: string; requestedModel?: string; routingMode?: Msg["routingMode"]; memoryUsedIds?: string[]; images?: MsgImage[]; videoUrl?: string };

export type Retrieval = { at: string; ids: string[] };

export type Chat = {
  notionWorkspaceId?: string;
  id: string;
  agentId?: string;
  botProvider?: NonNullable<BotModel["chatProvider"]>;
  botTier?: ModelTier;
  botKnowledge?: string;
  title: string;
  memory: "off" | "on";
  /** Retained preference when temporary-session policy forces effective memory off. */
  requestedMemory?: "off" | "on";
  temporary: boolean;
  autonomy: Autonomy;
  personalityId?: PersonalityId;
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
};

export type UsageEntry = {
  id: string;
  chatId: string;
  at: string;
  provider?: string;
  requestedModel?: string;
  model: string;
  requestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  kind: "actual" | "partial" | "unknown";
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
export type LocalFileVersion = { versionId: string; name: string; text: string; bytes: number; at: string; original?: LocalFileOriginal; partial?: boolean; extraction?: string };

export type LocalFile = {
  id: string;
  name: string;
  text: string;
  bytes: number;
  partial?: boolean;
  original?: LocalFileOriginal;
  versionId?: string;
  versions?: LocalFileVersion[];
  updatedAt?: string;
  extraction?: string;
  sourceChatId?: string;
  sourceMessageId?: string;
  projectId: string | null;
  createdAt: string;
};

export type Workspace = {
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
};

export type MemoryNote = { id: string; text: string; authority?: MemoryItem["authority"]; sourceRef?: MemoryItem["sourceRef"]; alwaysApply?: boolean };
