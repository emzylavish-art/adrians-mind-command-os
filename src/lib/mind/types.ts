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
  notionWorkspaceId?: string;
  id: string;
  agentId?: string;
  botProvider?: NonNullable<BotModel["chatProvider"]>;
  botTier?: ModelTier;
  botExactModel?: string;
  botKnowledge?: string;
  title: string;
  memory: "off" | "on";
  temporary: boolean;
  autonomy: Autonomy;
  personalityId?: PersonalityId;
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
  /** Imported notes with unresolved scope cannot be retrieved until reviewed. */
  reviewReason?: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

export type UsageEntry = {
  id: string;
  operationId?: string;
  channel?: "chat" | "orchestrator" | "speak" | "build" | "image" | "agent";
  stage?: string;
  outcome?: "unconfirmed" | "rejected_before_dispatch" | "completed" | "failed" | "canceled";
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
};

export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  target: string;
  result: string;
};

export type LocalFile = {
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

export type MemoryNote = { id: string; text: string };
