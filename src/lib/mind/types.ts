import type { PdfEvidenceIndex } from "./pdf-evidence.ts";
import type { ExecutionEvidence } from "./execution-evidence.ts";
import type { PersonalityId } from "./personalities/index.ts";
import type { BotModel } from "./bot-model.ts";
import type { ModelTier } from "./model-tiers.ts";
import type { HelperReceipt } from "./model-consult.ts";

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
  assetId?: string;
  parentAssetId?: string;
  operationId?: string;
  createdAt?: string;
  editPrompt?: string;
  preferred?: boolean;
  origin?: "attached" | "camera" | "generated" | "edited";
  /** Inline data URL when hydrated for display/send. May be omitted in persisted JSON when blobId is set. */
  dataUrl?: string;
  /** IndexedDB (or other blob store) key for large image bytes. Backward compatible with inline-only messages. */
  blobId?: string;
  name?: string;
  mime?: string;
};

export type Msg = {
  helperReceipts?: HelperReceipt[];
  executionId?: string;
  executionEvidence?: ExecutionEvidence;
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
  videoOperationId?: string;
  videoRetention?: "provider-temporary" | "local-download" | "account-storage";
  videoExpiresAt?: string | null;
};

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
  notionWorkspaceId?: string;
  id: string;
  agentId?: string;
  botProvider?: NonNullable<BotModel["chatProvider"]>;
  botTier?: ModelTier;
  botKnowledge?: string;
  botRevision?: number;
  /** Stable references explain copied document text without implying deletion erases history. */
  documentSources?: { fileId: string; revision: string; name: string; messageId?: string }[];
  title: string;
  memory: "off" | "on";
  contextPolicy?: ChatContextPolicy;
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
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  archived?: boolean;
};

export type UsageEntry = {
  executionId?: string;
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
  evidenceIndex?: PdfEvidenceIndex;
  id: string;
  name: string;
  text: string;
  bytes: number;
  partial?: boolean;
  projectId: string | null;
  createdAt: string;
  textSha256?: string;
  revision?: number;
  previousVersionId?: string;
  archived?: boolean;
  retrievalDisabled?: boolean;
  original?: { id: string; sha256: string; bytes: number; mime: string; storage: "browser" };
  extraction?: { method: "plain-text" | "pdf-text" | "legacy"; extractedCharacters: number; retainedCharacters: number; coverage: string; at: string };
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
  syncConflicts?: WorkspaceConflict[];
  toolPermissions?: Record<string, boolean>;
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

export type MemoryNote = { id: string; text: string };
