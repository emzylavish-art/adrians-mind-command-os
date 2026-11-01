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
  dataUrl: string;
  name?: string;
};

export type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  model?: string;
  /** Inline image attachments shown in the bubble and sent on the originating turn. */
  images?: MsgImage[];
};

export type Retrieval = { at: string; ids: string[] };

export type Chat = {
  id: string;
  title: string;
  memory: "off" | "on";
  temporary: boolean;
  autonomy: Autonomy;
  projectId: string | null;
  messages: Msg[];
  retrievalLog: Retrieval[];
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
  model: string;
  requestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  kind: "actual";
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
  projectId: string | null;
  createdAt: string;
};

export type Workspace = {
  version: 1;
  halted: boolean;
  chats: Chat[];
  memories: MemoryItem[];
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
