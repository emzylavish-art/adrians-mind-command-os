import type { ConsultAttempt } from "./model-consult.ts";
import type { PersonalityId } from "./personalities/index.ts";
import type { BotModel } from "./bot-model.ts";
import type { ModelTier } from "./model-tiers.ts";

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
  origin?: "attached" | "camera" | "generated" | "edited";
  /** Inline data URL when hydrated for display/send. May be omitted in persisted JSON when blobId is set. */
  dataUrl?: string;
  /** IndexedDB (or other blob store) key for large image bytes. Backward compatible with inline-only messages. */
  blobId?: string;
  name?: string;
  mime?: string;
};

export type Msg = {
  contextReceipt?: { availableMessages: number; includedMessages: number; omittedMessages: number; imageWarnings: string[] };
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  model?: string;
  provider?: string;
  requestedModel?: string;
  consult?: ConsultAttempt[];
  routingMode?: "A" | "B" | "C" | "D";
  deliveryOperationId?: string;
  deliveryRoute?: { provider: string; tier: ModelTier; model: string | null; orchestrated: boolean; fingerprint: string };
  delivery?: "submitted" | "unconfirmed" | "stopped" | "failed";
  kind?: "error";
  /** Inline image attachments shown in the bubble and sent on the originating turn. */
  images?: MsgImage[];
  /** Set when this assistant turn's SSE done reported a real memory save. */
  memorySaved?: boolean;
  savedMemoryId?: string | null;
  /** Temporary https link returned by the video service. */
  videoUrl?: string;
};

export type Retrieval = { at: string; ids: string[] };

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
  botKnowledge?: string;
  title: string;
  memory: "off" | "on";
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
  favorite?: boolean;
  archived?: boolean;
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
};

export type Project = {
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
  result: string;
};

export type LocalFile = {
  document?: { kind: "pdf"; pages: number; coverage: string; partial: boolean; chunks: import("./pdf-text.ts").PdfChunk[] };
  id: string;
  name: string;
  text: string;
  bytes: number;
  partial?: boolean;
  projectId: string | null;
  createdAt: string;
};

export type Workspace = {
  version: 1;
  halted: boolean;
  chats: Chat[];
  memories: MemoryItem[];
  deletedMemoryIds?: string[];
  deletedFileIds?: string[];
  recovery?: RecoveryRecord[];
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

export type RecoveryRecord = {
  id: string; at: string; action: string; target: string; message: string;
  state: "open" | "dismissed" | "resolved";
  chatId?: string; workspaceId?: string; operationId?: string;
  text?: string; pageId?: string | null; outcome?: string;
};

export type MemoryNote = { id: string; text: string };
