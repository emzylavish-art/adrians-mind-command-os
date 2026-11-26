import { runLocalPlan, type LocalTool } from "./local-tools.ts";
import { nextClock, zoneIsValid } from "./schedule-clock.ts";
import { scheduleRecovery } from "./schedule-recovery.ts";
import { scheduleOccurrences, type ScheduleTiming, type MissedSchedulePolicy } from "./schedule-policy.ts";
import { normalizeBotModel } from "./bot-model.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import type { ModelTier } from "./model-tiers.ts";
import type { Workspace } from "./types.ts";

export const FLEET_TOOLS = [
  "list_projects",
  "list_chats",
  "search_notes",
  "web_search",
  "browser",
  "gmail_read",
  "gmail_send",
  "model",
  "delegate",
] as const;

export type FleetTool = (typeof FLEET_TOOLS)[number];

export type RunState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_external"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "cancel_requested";

export type AgentDefinition = {
  id: string;
  /** Stable template origin, independent of the editable name. */
  templateId?: string;
  name: string;
  description: string;
  role: string;
  instructions: string;
  version: number;
  tools: FleetTool[];
  projectId: string | null;
  memory: "off" | "on";
  maxSteps: number;
  approval: "ask" | "automatic";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  chatProvider?: string | null;
  chatTier?: ModelTier | null;
  knowledge?: string;
  knowledgeDocumentIds?: string[];
};

export type DeploymentRecord = {
  id: string;
  agentId: string;
  agentVersion: number;
  target: "local-worker" | "hosted-worker";
  state: "local-ready" | "external-required";
  workerId: string | null;
  heartbeatAt: string | null;
  error: string;
};

export type RunStepResult = {
  stepId: string;
  tool: FleetTool;
  output: string;
  at: string;
  recordIds?: string[];
};

export type RunDefinition = Pick<AgentDefinition, "version" | "tools" | "projectId" | "memory" | "approval" | "maxSteps">;
export type RunCompletion = { execution: "finished" | "budget_exhausted" | "no_results"; objective: "unverified"; evidence: string[] };
export type AgentRun = {
  id: string;
  agentId: string;
  parentId: string | null;
  depth: number;
  goal: string;
  state: RunState;
  step: number;
  maxSteps: number;
  workerId: string | null;
  leaseUntil: string | null;
  approvedActions: string[];
  /** Legacy approvedActions are never authority. New grants bind this exact request. */
  pendingApproval?: RunApproval;
  approvalHistory?: RunApproval[];
  configuration?: RunConfiguration;
  stepResults?: FleetStepResult[];
  verification?: { state: "unverified" | "verified" | "not_met"; detail: string };
  externalOperation?: { id: string; stepId: string; state: "dispatching" | "succeeded" | "failed" | "unknown" | "not_sent"; startedAt: string; finishedAt?: string };
  delegationScope?: { tools: FleetTool[]; projectId: string | null; memory: "on" | "off" };
  plan: PlanStep[];
  definition?: RunDefinition;
  completion?: RunCompletion;
  executionRuntime?: "browser-local" | "scheduled-local" | "server-local";
  cancellation?: { requestedAt: string; acknowledgedAt: string | null; scope: "local-worker" };
  result: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  approvals?: LegacyRunApproval[];
  agentVersion?: number;
  planVersion?: number;
  chatId?: string;
  scheduleId?: string;
  scheduledAt?: string;
  execution?: { provider: string | null; tier: ModelTier | null; instructions: string; knowledge: string; projectId: string | null; memory: "on" | "off" };
  delegations?: { agentId: string; goal: string; allowedTools: FleetTool[]; maxSteps: number }[];
  modelOperation?: { id: string; state: "claimed" | "uncertain" | "completed"; provider: string; model?: string };
};

export type RunConfiguration = Pick<AgentDefinition, "version" | "instructions" | "tools" | "projectId" | "memory" | "approval" | "chatProvider" | "chatTier" | "knowledge" | "knowledgeDocumentIds">;
export type RunApproval = {
  id: string;
  tool: FleetTool;
  stepId: string;
  binding: string;
  destination: string;
  requestedAt: string;
  expiresAt: string;
  state: "requested" | "granted" | "consumed" | "expired" | "revoked" | "superseded";
  updatedAt: string;
  batchId?: string;
};

/** Historical approvals remain readable but cannot authorize dispatch. */
type LegacyRunApproval = {
  stepId: string;
  expiresAt: string;
  action: FleetTool;
  fingerprint: string;
  approvedAt: string;
  consumedAt?: string;
};

export type ScheduleOccurrence = {
  destinationChatId?: string;
  id: string;
  dueAt: string;
  runId?: string;
  state: RunState | "skipped";
  updatedAt: string;
  detail: string;
  missedCount?: number;
  deliveredAt?: string;
  deliveryError?: string;
};
export type FleetStepResult = {
  output?: string;
  recordIds?: string[];
  id: string;
  stepId: string;
  tool: FleetTool;
  at: string;
  status: "success" | "empty";
  text: string;
  originalLength: number;
  truncated: boolean;
  sources: { id: string; title: string; url: string; excerpt?: string }[];
  receipt?: { provider?: string; model?: string; accountId?: string; operationId?: string };
};
export const RUN_APPROVAL_TTL_MS = 5 * 60_000;
export const RUN_EVIDENCE_MAX_CHARS = 20_000;

export type RunEvent = {
  id: string;
  runId: string;
  at: string;
  kind: string;
  detail: string;
};

export type ProviderConnection = {
  id: string;
  provider: "grok" | "openai" | "anthropic" | "gemini" | "openrouter" | "ollama";
  label: string;
  secretStored: false;
  status: "unconfigured" | "server-configured";
};

export type MailboxAccount = {
  id: string;
  label: string;
  address: string;
  status: "not_connected";
};

export type ScheduleJob = {
  id: string;
  name: string;
  agentId: string | null;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
  chatId?: string;
  instruction?: string;
  lastAttemptAt?: string;
  lastQueuedRunId?: string;
  overlapPolicy?: "wait" | "queue" | "skip" | "parallel";
  maxParallel?: number;
  occurrences?: ScheduleOccurrence[];
  enabled: boolean;
  lastError: string;
  timeZone: string;
  clockHour: number | null;
  clockMinute: number | null;
  leaseWorker: string | null;
  leaseUntil: string | null;
  lastStatus: "" | "ran" | "failed";
  timing?: ScheduleTiming;
  missedPolicy?: MissedSchedulePolicy;
  missedOccurrences?: number;
  recoveryPending?: boolean;
  recoveryApprovalFor?: string;
  executionEnvironment?: "device";
  lastVerification?: "unverified" | "verified" | "not_met";
  resultDelivery?: "runs" | "conversation";
  approvedCatchUpFor?: string;
  executionTarget?: "browser" | "local-worker" | "hosted-worker";
  workerHeartbeatAt?: string;
  workerId?: string;
  missedCount?: number;
  skippedCount?: number;
};

export type PlanNeed = "none" | "search" | "browser" | "gmail" | "model";

export type PlanStep = {
  id: string;
  title: string;
  tool: FleetTool;
  dependsOn: string[];
  need: PlanNeed;
  input?: { url?: string; accountId?: string; connectionVersion?: string; recipients?: string[]; subject?: string; body?: string };
  selection?: "goal" | "template";
  inputFrom?: { stepId: string; field: "output" | "recordIds" };
};

export type FleetPin = { id: string; kind: "project" | "agent" | "chat" | "file"; ref: string };

export type BrowserSessionRecord = {
  id: string;
  runId: string | null;
  url: string;
  title: string;
  status: "open" | "failed" | "closed";
  lastAction: string;
  excerpt: string;
  excerptTruncated?: boolean;
  evidenceId?: string;
  updatedAt: string;
};

export type FleetShape = {
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

const LOCAL = new Set<FleetTool>(["list_projects", "list_chats", "search_notes"]);
const TERMINAL = new Set<RunState>(["completed", "failed", "canceled"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP = /^https?:\/\/\S+$/i;
const PIN_KINDS = new Set(["project", "agent", "chat", "file"]);
export const PLAN_MAX_CHILDREN = 2;

function needOf(tool: FleetTool): PlanNeed {
  if (tool === "web_search") return "search";
  if (tool === "browser") return "browser";
  if (tool === "gmail_read" || tool === "gmail_send") return "gmail";
  if (tool === "model") return "model";
  return "none";
}

const GOAL_TOOL_INTENTS: Record<FleetTool, RegExp> = {
    list_projects: /\b(?:list|show|find|inspect|review)\s+(?:(?:my|all|saved|available|the)\s+)*(?:projects?|project list)\b/i,
    list_chats: /\b(?:list|show|find|inspect|review)\s+(?:(?:my|all|saved|available|the)\s+)*(?:chats?|conversations?)\b/i,
    search_notes: /\b(?:search|find|read|show|review)\s+(?:(?:my|all|saved|relevant|the)\s+)*(?:notes?|memories|memory)\b/i,
    web_search: /\b(?:search\s+(?:the\s+)?(?:web|internet)|research|find\s+(?:online\s+)?sources)\b/i,
    browser: /https?:\/\/\S+|\b(?:open|read|browse|inspect)\s+(?:the\s+)?(?:page|website|url)\b/i,
    gmail_read: /\b(?:read|find|search|list|show)\s+(?:(?:my|all|the|unread)\s+)*(?:emails?|inbox|mailbox)\b/i,
    gmail_send: /\b(?:send|reply|forward)\s+(?:(?:an?|the)\s+)*(?:emails?|mail|message|note)\b/i,
    model: /\b(?:summari[sz]e|reason|think|analy[sz]e|draft)\b/i,
    delegate: /\b(?:delegate|split\s+(?:the\s+)?work)\b/i,
};
function explicitGoalTools(goal: string): FleetTool[] {
  return FLEET_TOOLS.filter((tool) => GOAL_TOOL_INTENTS[tool].test(goal));
}

export function buildTaskPlan(goal: string, tools: FleetTool[]): PlanStep[] {
  const title = goal.trim().slice(0, 160);
  const requested = explicitGoalTools(goal);
  const selected = requested.length ? tools.filter(tool => requested.includes(tool)) : tools;
  return selected
    .slice(0, 8)
    .map((tool, index) => ({
      id: `step-${index + 1}`,
      title,
      tool,
      dependsOn: index === 0 ? [] : [`step-${index}`],
      need: needOf(tool),
      selection: requested.length ? "goal" as const : "template" as const,
    }));
}

/** Independent pieces of one goal. Capped so delegation cannot fan out. */
export function delegationGoals(goal: string): string[] {
  const parts = goal.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  const goals = parts.length > PLAN_MAX_CHILDREN
    ? [...parts.slice(0, PLAN_MAX_CHILDREN - 1), parts.slice(PLAN_MAX_CHILDREN - 1).join(" and ")]
    : parts;
  return goals.length > 0 ? goals : [goal.trim().slice(0, 2000)];
}

const NEXT_STATE: Record<RunState, readonly RunState[]> = {
  queued: ["running", "paused", "canceled", "failed"],
  running: ["queued", "waiting_approval", "waiting_external", "paused", "completed", "failed", "canceled"],
  waiting_approval: ["queued", "paused", "canceled", "failed"],
  waiting_external: ["queued", "paused", "canceled", "failed"],
  paused: ["queued", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
  cancel_requested: ["canceled", "failed"],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return NEXT_STATE[from].includes(to);
}

export function toolCatalog(): { id: FleetTool; name: string; available: boolean; reason: string }[] {
  return [
    { id: "list_projects", name: "List projects", available: true, reason: "Reads projects already stored in this browser." },
    { id: "list_chats", name: "List chats", available: true, reason: "Reads chats already stored in this browser." },
    { id: "search_notes", name: "Search notes", available: true, reason: "Reads notes already stored in this browser." },
    { id: "web_search", name: "Web search", available: false, reason: "No search provider is configured. Nothing is searched." },
    { id: "browser", name: "Browser", available: false, reason: "The worker does not open a page unless a driver is attached and the action is approved." },
    { id: "gmail_read", name: "Gmail read", available: false, reason: "No Gmail account is connected." },
    { id: "gmail_send", name: "Gmail send", available: false, reason: "No Gmail account is connected. A send still asks first." },
    { id: "model", name: "Model", available: false, reason: "This worker does not call a model." },
    { id: "delegate", name: "Delegate", available: true, reason: "Splits one goal into at most two child runs, one level deep. It does not call a model." },
  ];
}

export const AGENT_TEMPLATES: (Omit<AgentDefinition, "id" | "createdAt" | "updatedAt" | "version" | "archived" | "projectId"> & { templateId: string })[] = [
  { templateId: "builtin:personal-assistant", name: "Personal assistant", description: "Reads projects, chats, and notes on this device.", role: "assistant", instructions: "Use only the granted local reads.", tools: ["list_projects", "list_chats", "search_notes"], memory: "off", maxSteps: 6, approval: "automatic" },
  { templateId: "builtin:research", name: "Research", description: "Searches notes, then a configured search provider. It does not invent citations.", role: "research", instructions: "Stop when search is not configured.", tools: ["search_notes", "web_search"], memory: "off", maxSteps: 4, approval: "ask" },
  { templateId: "builtin:browser-operator", name: "Browser operator", description: "Opens one approved http(s) page when a browser driver is attached.", role: "browser", instructions: "Do not browse without approval.", tools: ["browser"], memory: "off", maxSteps: 2, approval: "ask" },
  { templateId: "builtin:coding", name: "Coding", description: "Lists projects on this device. It does not edit the repository.", role: "coding", instructions: "Do not claim a code change.", tools: ["list_projects"], memory: "off", maxSteps: 2, approval: "automatic" },
  { templateId: "builtin:email", name: "Email", description: "Reads or sends mail only after a mailbox is connected and a send is approved.", role: "email", instructions: "Never send without approval.", tools: ["gmail_read", "gmail_send"], memory: "off", maxSteps: 3, approval: "ask" },
  { templateId: "builtin:project-manager", name: "Project manager", description: "Lists work, then delegates one level to the same agent without repeating delegation.", role: "manager", instructions: "Delegate once.", tools: ["list_projects", "delegate"], memory: "off", maxSteps: 4, approval: "automatic" },
  { templateId: "builtin:documents", name: "Documents", description: "Searches notes on this device.", role: "documents", instructions: "Stay inside notes.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
  { templateId: "builtin:data-analysis", name: "Data analysis", description: "Searches notes. It does not invent charts or totals.", role: "data", instructions: "Report only note text.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
  { templateId: "builtin:knowledge", name: "Knowledge", description: "Lists projects and searches notes the owner already saved.", role: "knowledge", instructions: "Do not search the web.", tools: ["list_projects", "search_notes"], memory: "on", maxSteps: 4, approval: "automatic" },
  { templateId: "builtin:content", name: "Content", description: "Searches notes for source material. It does not generate images or video.", role: "content", instructions: "Do not call a media API.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
];

function stamp(now?: string) {
  return now ?? new Date().toISOString();
}

function nid(prefix: string) {
  const cryptoRef = globalThis.crypto;
  const body = cryptoRef?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${body}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function configurationOf(agent: AgentDefinition): RunConfiguration {
  return {
    version: agent.version, instructions: agent.instructions, tools: [...agent.tools],
    projectId: agent.projectId, memory: agent.memory, approval: agent.approval,
    chatProvider: agent.chatProvider ?? null, chatTier: agent.chatTier ?? null,
    knowledge: agent.knowledge ?? "",
    knowledgeDocumentIds: [...(agent.knowledgeDocumentIds ?? [])].sort(),
  };
}

function readConfiguration(value: unknown): RunConfiguration | undefined {
  if (!isRecord(value) || typeof value.version !== "number") return undefined;
  return {
    version: value.version,
    instructions: typeof value.instructions === "string" ? value.instructions.slice(0, 2000) : "",
    tools: toolList(value.tools), projectId: typeof value.projectId === "string" ? value.projectId : null,
    memory: value.memory === "on" ? "on" : "off", approval: value.approval === "ask" ? "ask" : "automatic",
    ...normalizeBotModel(value), knowledge: normalizeBotKnowledge(value.knowledge).knowledge,
    knowledgeDocumentIds: Array.isArray(value.knowledgeDocumentIds) ? [...new Set(value.knowledgeDocumentIds.filter((id): id is string => typeof id === "string" && id.length <= 200))].slice(0, 100).sort() : [],
  };
}

function readApproval(value: unknown): RunApproval | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.tool !== "string" || !FLEET_TOOLS.includes(value.tool as FleetTool)
    || typeof value.stepId !== "string" || typeof value.binding !== "string" || value.binding.length > 140_000
    || typeof value.requestedAt !== "string" || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return undefined;
  return {
    id: value.id, tool: value.tool as FleetTool, stepId: value.stepId, binding: value.binding,
    destination: typeof value.destination === "string" ? value.destination.slice(0, 2000) : "",
    requestedAt: value.requestedAt, expiresAt: value.expiresAt,
    state: ["granted", "consumed", "expired", "revoked", "superseded"].includes(String(value.state)) ? value.state as RunApproval["state"] : "requested",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : value.requestedAt,
    batchId: typeof value.batchId === "string" ? value.batchId : undefined,
  };
}

function readStepResults(value: unknown): FleetStepResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter(row => typeof row.stepId === "string" && (typeof row.id === "string" || typeof row.output === "string") && FLEET_TOOLS.includes(row.tool as FleetTool)).slice(0, 20).map(row => {
    const text = typeof row.text === "string" ? row.text : typeof row.output === "string" ? row.output : "";
    return {
      output: text.slice(0, 4000), recordIds: Array.isArray(row.recordIds) ? row.recordIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [],
      id: String(row.id ?? row.stepId), stepId: String(row.stepId), tool: row.tool as FleetTool,
      at: typeof row.at === "string" ? row.at : "", status: row.status === "empty" ? "empty" : "success",
      text: text.slice(0, RUN_EVIDENCE_MAX_CHARS), originalLength: typeof row.originalLength === "number" ? row.originalLength : text.length,
      truncated: row.truncated === true || text.length > RUN_EVIDENCE_MAX_CHARS,
      receipt: isRecord(row.receipt) ? {
        ...(typeof row.receipt.provider === "string" ? { provider: row.receipt.provider.slice(0, 300) } : {}),
        ...(typeof row.receipt.model === "string" ? { model: row.receipt.model.slice(0, 200) } : {}),
        ...(typeof row.receipt.accountId === "string" ? { accountId: row.receipt.accountId.slice(0, 200) } : {}),
        ...(typeof row.receipt.operationId === "string" ? { operationId: row.receipt.operationId.slice(0, 300) } : {}),
      } : undefined,
      sources: Array.isArray(row.sources) ? row.sources.filter(isRecord).slice(0, 30).map(source => ({
        id: typeof source.id === "string" ? source.id : "", title: typeof source.title === "string" ? source.title.slice(0, 300) : "",
        url: typeof source.url === "string" ? source.url.slice(0, 2000) : "",
        ...(typeof source.excerpt === "string" ? { excerpt: source.excerpt.slice(0, 2000) } : {}),
      })) : [],
    };
  });
}

function toolList(value: unknown): FleetTool[] {
  if (!Array.isArray(value)) return [];
  const tools: FleetTool[] = [];
  for (const item of value) {
    if (typeof item === "string" && (FLEET_TOOLS as readonly string[]).includes(item) && !tools.includes(item as FleetTool)) {
      tools.push(item as FleetTool);
    }
  }
  return tools.slice(0, 12);
}

export function emptyFleet(): FleetShape {
  return {
    agents: [],
    deployments: [],
    runs: [],
    runEvents: [],
    connections: [],
    mailboxes: [],
    schedules: [],
    pins: [],
    browserSessions: [],
  };
}

export function readFleet(input: unknown): FleetShape {
  const fleet = emptyFleet();
  if (!isRecord(input)) return fleet;
  if (Array.isArray(input.agents)) {
    for (const row of input.agents) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) continue;
      fleet.agents.push({
        ...(typeof row.templateId === "string" && AGENT_TEMPLATES.some(template => template.templateId === row.templateId) ? { templateId: row.templateId } : {}),
        id: row.id,
        name: row.name.slice(0, 80),
        description: typeof row.description === "string" ? row.description.slice(0, 400) : "",
        role: typeof row.role === "string" ? row.role.slice(0, 40) : "agent",
        instructions: typeof row.instructions === "string" ? row.instructions.slice(0, 2000) : "",
        version: typeof row.version === "number" ? row.version : 1,
        tools: toolList(row.tools),
        projectId: typeof row.projectId === "string" ? row.projectId : null,
        memory: row.memory === "on" ? "on" : "off",
        maxSteps: typeof row.maxSteps === "number" ? Math.min(20, Math.max(1, row.maxSteps)) : 4,
        approval: row.approval === "ask" ? "ask" : "automatic",
        archived: row.archived === true,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : stamp(),
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : stamp(),
        ...normalizeBotModel(row),
        knowledge: normalizeBotKnowledge(row.knowledge).knowledge,
        ...(Array.isArray(row.knowledgeDocumentIds) ? { knowledgeDocumentIds: [...new Set(row.knowledgeDocumentIds.filter((id): id is string => typeof id === "string" && id.length <= 200))].slice(0, 100) } : {}),
      });
    }
  }
  if (Array.isArray(input.deployments)) {
    for (const row of input.deployments) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.agentId !== "string") continue;
      fleet.deployments.push({
        id: row.id,
        agentId: row.agentId,
        agentVersion: typeof row.agentVersion === "number" ? row.agentVersion : 1,
        target: row.target === "hosted-worker" ? "hosted-worker" : "local-worker",
        state: row.state === "local-ready" ? "local-ready" : "external-required",
        workerId: typeof row.workerId === "string" ? row.workerId : null,
        heartbeatAt: typeof row.heartbeatAt === "string" ? row.heartbeatAt : null,
        error: typeof row.error === "string" ? row.error.slice(0, 300) : "",
      });
    }
  }
  if (Array.isArray(input.runs)) {
    for (const row of input.runs) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.agentId !== "string") continue;
      const state = typeof row.state === "string" && ["queued", "running", "waiting_approval", "waiting_external", "paused", "completed", "failed", "canceled", "cancel_requested"].includes(row.state)
        ? (row.state as RunState)
        : "failed";
      fleet.runs.push({
        id: row.id,
        agentId: row.agentId,
        parentId: typeof row.parentId === "string" ? row.parentId : null,
        depth: row.depth === 1 ? 1 : 0,
        goal: typeof row.goal === "string" ? row.goal.slice(0, 2000) : "",
        state,
        step: typeof row.step === "number" ? row.step : 0,
        maxSteps: typeof row.maxSteps === "number" ? row.maxSteps : 4,
        workerId: typeof row.workerId === "string" ? row.workerId : null,
        leaseUntil: typeof row.leaseUntil === "string" ? row.leaseUntil : null,
        approvedActions: Array.isArray(row.approvedActions) ? row.approvedActions.filter((item): item is string => typeof item === "string").slice(0, 12) : [],
        pendingApproval: readApproval(row.pendingApproval),
        approvalHistory: Array.isArray(row.approvalHistory) ? row.approvalHistory.map(readApproval).filter((approval): approval is RunApproval => !!approval).slice(-40) : [],
        agentVersion: typeof row.agentVersion === "number" ? row.agentVersion : undefined,
        chatId: typeof row.chatId === "string" ? row.chatId : undefined,
        scheduleId: typeof row.scheduleId === "string" ? row.scheduleId : undefined,
        scheduledAt: typeof row.scheduledAt === "string" ? row.scheduledAt : undefined,
        execution: isRecord(row.execution) ? {
          provider: typeof row.execution.provider === "string" ? row.execution.provider : null,
          tier: normalizeBotModel({ chatTier: row.execution.tier }).chatTier ?? null,
          instructions: typeof row.execution.instructions === "string" ? row.execution.instructions.slice(0, 2000) : "",
          knowledge: typeof row.execution.knowledge === "string" ? row.execution.knowledge.slice(0, 12000) : "",
          projectId: typeof row.execution.projectId === "string" ? row.execution.projectId : null,
          memory: row.execution.memory === "on" ? "on" : "off",
        } : undefined,
        delegations: Array.isArray(row.delegations) ? row.delegations.filter(isRecord).filter((item) => typeof item.agentId === "string" && typeof item.goal === "string").slice(0, PLAN_MAX_CHILDREN).map((item) => ({ agentId: item.agentId as string, goal: (item.goal as string).slice(0, 2000), allowedTools: toolList(item.allowedTools), maxSteps: Math.min(20, Math.max(1, Number(item.maxSteps) || 1)) })) : undefined,
        modelOperation: isRecord(row.modelOperation) && typeof row.modelOperation.id === "string" && typeof row.modelOperation.provider === "string" && ["claimed", "uncertain", "completed"].includes(String(row.modelOperation.state)) ? { id: row.modelOperation.id, provider: row.modelOperation.provider, state: row.modelOperation.state as "claimed" | "uncertain" | "completed", model: typeof row.modelOperation.model === "string" ? row.modelOperation.model : undefined } : undefined,
        approvals: readApprovals(row.approvals),
        configuration: readConfiguration(row.configuration),
        stepResults: readStepResults(row.stepResults),
        verification: isRecord(row.verification) ? { state: row.verification.state === "verified" ? "verified" : row.verification.state === "not_met" ? "not_met" : "unverified", detail: typeof row.verification.detail === "string" ? row.verification.detail.slice(0, 500) : "" } : undefined,
        externalOperation: isRecord(row.externalOperation) && typeof row.externalOperation.id === "string" && typeof row.externalOperation.stepId === "string" ? {
          id: row.externalOperation.id, stepId: row.externalOperation.stepId,
          state: row.externalOperation.state === "succeeded" || row.externalOperation.state === "failed" || row.externalOperation.state === "unknown" || row.externalOperation.state === "not_sent" ? row.externalOperation.state : "dispatching",
          startedAt: typeof row.externalOperation.startedAt === "string" ? row.externalOperation.startedAt : "",
          ...(typeof row.externalOperation.finishedAt === "string" ? { finishedAt: row.externalOperation.finishedAt } : {}),
        } : undefined,
        delegationScope: isRecord(row.delegationScope) ? { tools: toolList(row.delegationScope.tools), projectId: typeof row.delegationScope.projectId === "string" ? row.delegationScope.projectId : null, memory: row.delegationScope.memory === "on" ? "on" : "off" } : undefined,
        plan: readPlan(row.plan),
        definition: readRunDefinition(row.definition),
        completion: readCompletion(row.completion),
        executionRuntime: row.executionRuntime === "scheduled-local" || row.executionRuntime === "server-local" ? row.executionRuntime : "browser-local",
        cancellation: isRecord(row.cancellation) && typeof row.cancellation.requestedAt === "string" ? { requestedAt: row.cancellation.requestedAt, acknowledgedAt: typeof row.cancellation.acknowledgedAt === "string" ? row.cancellation.acknowledgedAt : null, scope: "local-worker" } : undefined,
        result: typeof row.result === "string" ? row.result.slice(0, 4000) : "",
        error: typeof row.error === "string" ? row.error.slice(0, 500) : "",
        createdAt: typeof row.createdAt === "string" ? row.createdAt : stamp(),
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : stamp(),
      });
    }
  }
  if (Array.isArray(input.runEvents)) {
    for (const row of input.runEvents) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.runId !== "string") continue;
      fleet.runEvents.push({
        id: row.id,
        runId: row.runId,
        at: typeof row.at === "string" ? row.at : stamp(),
        kind: typeof row.kind === "string" ? row.kind.slice(0, 40) : "event",
        detail: typeof row.detail === "string" ? row.detail.slice(0, 500) : "",
      });
    }
  }
  if (Array.isArray(input.connections)) {
    for (const row of input.connections) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.label !== "string") continue;
      const provider = row.provider;
      if (provider !== "grok" && provider !== "openai" && provider !== "anthropic" && provider !== "gemini" && provider !== "openrouter" && provider !== "ollama") continue;
      fleet.connections.push({
        id: row.id,
        provider,
        label: row.label.slice(0, 80),
        secretStored: false,
        status: row.status === "server-configured" && provider === "grok" ? "server-configured" : "unconfigured",
      });
    }
  }
  if (Array.isArray(input.mailboxes)) {
    for (const row of input.mailboxes) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.address !== "string") continue;
      fleet.mailboxes.push({
        id: row.id,
        label: typeof row.label === "string" ? row.label.slice(0, 80) : row.address,
        address: row.address.slice(0, 120),
        status: "not_connected",
      });
    }
  }
  if (Array.isArray(input.schedules)) {
    for (const row of input.schedules) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string") continue;
      fleet.schedules.push({
        id: row.id,
        name: row.name.slice(0, 80),
        agentId: typeof row.agentId === "string" ? row.agentId : null,
        intervalMinutes: typeof row.intervalMinutes === "number" ? Math.min(10_080, Math.max(5, row.intervalMinutes)) : 1440,
        nextRunAt: typeof row.nextRunAt === "string" ? row.nextRunAt : stamp(),
        chatId: typeof row.chatId === "string" ? row.chatId : undefined,
        instruction: typeof row.instruction === "string" ? row.instruction.slice(0, 2000) : undefined,
        lastQueuedRunId: typeof row.lastQueuedRunId === "string" ? row.lastQueuedRunId : undefined,
        overlapPolicy: row.overlapPolicy === "parallel" || row.overlapPolicy === "skip" ? row.overlapPolicy : "queue",
        maxParallel: typeof row.maxParallel === "number" ? Math.min(4, Math.max(1, Math.floor(row.maxParallel))) : 2,
        occurrences: readOccurrences(row.occurrences),
        resultDelivery: row.resultDelivery === "conversation" ? "conversation" : "runs",
        lastAttemptAt: typeof row.lastAttemptAt === "string" ? row.lastAttemptAt : undefined,
        lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
        enabled: row.enabled !== false,
        lastError: typeof row.lastError === "string" ? row.lastError.slice(0, 300) : "",
        timeZone: typeof row.timeZone === "string" && row.timeZone ? row.timeZone.slice(0, 80) : "UTC",
        clockHour: typeof row.clockHour === "number" ? Math.min(23, Math.max(0, Math.floor(row.clockHour))) : null,
        clockMinute: typeof row.clockMinute === "number" ? Math.min(59, Math.max(0, Math.floor(row.clockMinute))) : null,
        leaseWorker: typeof row.leaseWorker === "string" ? row.leaseWorker.slice(0, 80) : null,
        leaseUntil: typeof row.leaseUntil === "string" ? row.leaseUntil : null,
        lastStatus: row.lastStatus === "ran" || row.lastStatus === "failed" ? row.lastStatus : "",
        timing: row.timing === "fixed_delay" ? "fixed_delay" : "fixed_rate",
        missedPolicy: row.missedPolicy === "skip" || row.missedPolicy === "ask" || row.missedPolicy === "all" || row.missedPolicy === "review" || row.missedPolicy === "once" || row.missedPolicy === "run-once" || row.missedPolicy === "catch-up" ? row.missedPolicy : "latest",
        missedOccurrences: typeof row.missedOccurrences === "number" ? Math.max(0, row.missedOccurrences) : 0,
        recoveryPending: row.recoveryPending === true,
        recoveryApprovalFor: typeof row.recoveryApprovalFor === "string" ? row.recoveryApprovalFor : undefined,
        executionEnvironment: "device",
        executionTarget: row.executionTarget === "local-worker" || row.executionTarget === "hosted-worker" ? row.executionTarget : "browser",
        workerHeartbeatAt: typeof row.workerHeartbeatAt === "string" ? row.workerHeartbeatAt : undefined,
        workerId: typeof row.workerId === "string" ? row.workerId : undefined,
        skippedCount: Math.max(0, Number(row.skippedCount) || 0),
        lastVerification: row.lastVerification === "verified" || row.lastVerification === "not_met" ? row.lastVerification : "unverified",
      });
    }
  }
  if (Array.isArray(input.pins)) {
    for (const row of input.pins) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.ref !== "string") continue;
      if (row.kind !== "project" && row.kind !== "agent" && row.kind !== "chat" && row.kind !== "file") continue;
      if (!PIN_KINDS.has(row.kind)) continue;
      fleet.pins.push({ id: row.id, kind: row.kind, ref: row.ref });
    }
  }
  if (Array.isArray(input.browserSessions)) {
    for (const row of input.browserSessions) {
      if (!isRecord(row) || typeof row.id !== "string") continue;
      fleet.browserSessions.push({
        id: row.id,
        runId: typeof row.runId === "string" ? row.runId : null,
        url: typeof row.url === "string" ? row.url.slice(0, 300) : "",
        title: typeof row.title === "string" ? row.title.slice(0, 160) : "",
        status: row.status === "open" ? "open" : row.status === "closed" ? "closed" : "failed",
        lastAction: typeof row.lastAction === "string" ? row.lastAction.slice(0, 300) : "",
        excerpt: typeof row.excerpt === "string" ? row.excerpt.slice(0, 500) : "",
        excerptTruncated: row.excerptTruncated === true || (typeof row.excerpt === "string" && row.excerpt.length > 500),
        evidenceId: typeof row.evidenceId === "string" ? row.evidenceId : undefined,
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : stamp(),
      });
    }
  }
  fleet.mailboxes = fleet.mailboxes.slice(0, 500);
  fleet.runEvents = fleet.runEvents.slice(0, 400);
  return fleet;
}

function readApprovals(value: unknown): LegacyRunApproval[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => isRecord(row) && typeof row.stepId === "string" && typeof row.action === "string" && (FLEET_TOOLS as readonly string[]).includes(row.action) && typeof row.fingerprint === "string" && typeof row.approvedAt === "string" && typeof row.expiresAt === "string")
    .slice(0, 20).map((row) => ({ stepId: row.stepId.slice(0, 40), action: row.action as FleetTool, fingerprint: row.fingerprint.slice(0, 12000), approvedAt: row.approvedAt, expiresAt: row.expiresAt, ...(typeof row.consumedAt === "string" ? { consumedAt: row.consumedAt } : {}) }));
}

function readRunDefinition(value: unknown): RunDefinition | undefined {
  if (!isRecord(value) || !Number.isInteger(value.version) || !Array.isArray(value.tools)) return undefined;
  return { version: value.version as number, tools: toolList(value.tools), projectId: typeof value.projectId === "string" ? value.projectId : null,
    memory: value.memory === "on" ? "on" : "off", approval: value.approval === "automatic" ? "automatic" : "ask", maxSteps: typeof value.maxSteps === "number" ? Math.max(1, Math.min(20, Math.floor(value.maxSteps))) : 4 };
}
function readCompletion(value: unknown): RunCompletion | undefined {
  if (!isRecord(value) || !["finished", "budget_exhausted", "no_results"].includes(String(value.execution))) return undefined;
  return { execution: value.execution as RunCompletion["execution"], objective: "unverified", evidence: Array.isArray(value.evidence) ? value.evidence.filter((v): v is string => typeof v === "string").slice(0, 20) : [] };
}
function readOccurrences(value: unknown): ScheduleOccurrence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): ScheduleOccurrence[] => {
    if (!isRecord(row) || typeof row.updatedAt !== "string" || typeof row.state !== "string" ||
        (row.state !== "skipped" && !Object.hasOwn(NEXT_STATE, row.state))) return [];
    const id = row.id ?? row.runId;
    const dueAt = row.dueAt ?? row.scheduledAt;
    if (typeof id !== "string" || typeof dueAt !== "string") return [];
    return [{ id, dueAt, runId: typeof row.runId === "string" ? row.runId : undefined,
      updatedAt: row.updatedAt, state: row.state as ScheduleOccurrence["state"],
      detail: typeof row.detail === "string" ? row.detail.slice(0, 500) : "",
      missedCount: typeof row.missedCount === "number" ? Math.max(0, Math.floor(row.missedCount)) : 0,
      destinationChatId: typeof row.destinationChatId === "string" ? row.destinationChatId : undefined,
      deliveredAt: typeof row.deliveredAt === "string" ? row.deliveredAt : undefined,
      deliveryError: typeof row.deliveryError === "string" ? row.deliveryError.slice(0, 500) : undefined }];
  }).slice(-100);
}

function snapshotDefinition(agent: AgentDefinition): RunDefinition {
  return { version: agent.version, tools: [...agent.tools], projectId: agent.projectId, memory: agent.memory, approval: agent.approval, maxSteps: agent.maxSteps };
}

function readPlan(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.tool !== "string") return [];
    if (!(FLEET_TOOLS as readonly string[]).includes(row.tool)) return [];
    const dependsOn = Array.isArray(row.dependsOn) ? row.dependsOn.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
    steps.push({
      id: row.id.slice(0, 40),
      title: typeof row.title === "string" ? row.title.slice(0, 160) : "",
      tool: row.tool as FleetTool,
      dependsOn,
      ...(isRecord(row.inputFrom) && typeof row.inputFrom.stepId === "string" && (row.inputFrom.field === "output" || row.inputFrom.field === "recordIds")
        ? { inputFrom: { stepId: row.inputFrom.stepId, field: row.inputFrom.field } } : {}),
      need: row.need === "search" || row.need === "browser" || row.need === "gmail" || row.need === "model" ? row.need : "none",
      ...(isRecord(row.input) ? { input: {
        ...(typeof row.input.url === "string" ? { url: row.input.url.slice(0, 2000) } : {}),
        ...(typeof row.input.accountId === "string" ? { accountId: row.input.accountId.slice(0, 200) } : {}),
        ...(typeof row.input.connectionVersion === "string" ? { connectionVersion: row.input.connectionVersion.slice(0, 100) } : {}),
        ...(Array.isArray(row.input.recipients) ? { recipients: row.input.recipients.filter((value): value is string => typeof value === "string").slice(0, 50) } : {}),
        ...(typeof row.input.subject === "string" ? { subject: row.input.subject.slice(0, 1000) } : {}),
        ...(typeof row.input.body === "string" ? { body: row.input.body.slice(0, 8000) } : {}),
      } } : {}),
    });
  }
  return steps.slice(0, 8);
}

function withFleet(ws: Workspace, fleet: FleetShape): Workspace {
  return { ...ws, ...fleet };
}

function event(fleet: FleetShape, runId: string, at: string, kind: string, detail: string) {
  fleet.runEvents.unshift({ id: nid("ev"), runId, at, kind, detail: detail.slice(0, 500) });
  fleet.runEvents = fleet.runEvents.slice(0, 400);
}

export function addAgentFromTemplate(ws: Workspace, templateName: string, now?: string): { ok: true; ws: Workspace; agent: AgentDefinition } | { ok: false; error: string } {
  const template = AGENT_TEMPLATES.find((item) => item.name === templateName);
  if (!template) return { ok: false, error: "That template is not in the library." };
  const at = stamp(now);
  const agent: AgentDefinition = { ...template, tools: [...template.tools], id: nid("agent"), version: 1, archived: false, projectId: null, createdAt: at, updatedAt: at };
  return { ok: true, agent, ws: { ...ws, agents: [agent, ...ws.agents] } };
}

export type BotDraft = {
  name: string;
  instructions: string;
  tools: FleetTool[];
  description?: string;
  projectId?: string | null;
  chatProvider?: string | null;
  chatTier?: ModelTier | null;
  knowledge?: string;
  knowledgeDocumentIds?: string[];
};

export function addCustomAgent(
  ws: Workspace,
  input: BotDraft,
  now?: string,
): { ok: true; ws: Workspace; agent: AgentDefinition } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the agent." };
  if (input.instructions.trim().length > 2000) return { ok: false, error: "Agent instructions exceed 2,000 characters. Shorten them before saving; nothing was truncated or saved." };
  const tools = toolList(input.tools);
  if (tools.length === 0) return { ok: false, error: "Choose at least one tool." };
  const at = stamp(now);
  const knowledge = normalizeBotKnowledge(input.knowledge);
  if (knowledge.rejected) return { ok: false, error: knowledge.rejected };
  const agent: AgentDefinition = {
    id: nid("agent"),
    name,
    description: input.description?.trim().slice(0, 400) || "Custom bot",
    role: "custom",
    instructions: input.instructions.trim().slice(0, 2000),
    version: 1,
    tools,
    projectId: ws.projects.some((project) => project.id === input.projectId) ? input.projectId! : null,
    memory: "off",
    maxSteps: Math.min(8, Math.max(1, tools.length)),
    approval: tools.some((tool) => tool === "browser" || tool === "gmail_send") ? "ask" : "automatic",
    archived: false,
    createdAt: at,
    updatedAt: at,
    ...normalizeBotModel(input),
    knowledge: knowledge.knowledge,
    knowledgeDocumentIds: [...new Set((input.knowledgeDocumentIds ?? []).filter((id) => typeof id === "string" && id.length <= 200))].slice(0, 100),
  };
  return { ok: true, agent, ws: { ...ws, agents: [agent, ...ws.agents] } };
}

export function editBot(ws: Workspace, id: string, draft: BotDraft): ReturnType<typeof addCustomAgent> {
  const original = ws.agents.find((agent) => agent.id === id && !agent.archived);
  if (!original) return { ok: false, error: "This bot is no longer available." };
  if (ws.runs.some((run) => run.agentId === id && !TERMINAL.has(run.state))) {
    return { ok: false, error: "Finish or stop this bot’s open runs before changing its configuration." };
  }
  const checked = addCustomAgent(ws, draft);
  if (!checked.ok) return checked;
  const agent = {
    ...original,
    name: checked.agent.name,
    description: checked.agent.description,
    instructions: checked.agent.instructions,
    tools: checked.agent.tools,
    projectId: checked.agent.projectId,
    chatProvider: checked.agent.chatProvider ?? null,
    chatTier: checked.agent.chatTier ?? null,
    knowledge: checked.agent.knowledge ?? "",
    knowledgeDocumentIds: checked.agent.knowledgeDocumentIds ?? [],
    approval: original.approval === "ask" ? "ask" as const : checked.agent.approval,
    maxSteps: checked.agent.maxSteps,
    updatedAt: checked.agent.updatedAt,
    version: original.version + 1,
  };
  return { ok: true, agent, ws: { ...ws, agents: ws.agents.map((item) => item.id === id ? agent : item) } };
}

export function togglePin(ws: Workspace, kind: FleetPin["kind"], ref: string): Workspace {
  const id = ref.trim();
  if (!id || !PIN_KINDS.has(kind)) return ws;
  const existing = ws.pins.find((pin) => pin.kind === kind && pin.ref === id);
  if (existing) return { ...ws, pins: ws.pins.filter((pin) => pin.id !== existing.id) };
  if (ws.pins.length >= 24) return ws;
  return { ...ws, pins: [{ id: nid("pin"), kind, ref: id }, ...ws.pins] };
}

export function addConnection(ws: Workspace, provider: ProviderConnection["provider"], label: string, serverGrok = false): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const name = label.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the connection." };
  const row: ProviderConnection = {
    id: nid("conn"),
    provider,
    label: name,
    secretStored: false,
    status: provider === "grok" && serverGrok ? "server-configured" : "unconfigured",
  };
  return { ok: true, ws: { ...ws, connections: [row, ...ws.connections] } };
}

export function addMailbox(ws: Workspace, label: string, address: string): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const email = address.trim().slice(0, 120);
  if (!EMAIL.test(email)) return { ok: false, error: "That email address is not usable. Nothing was connected." };
  if (ws.mailboxes.length >= 500) return { ok: false, error: "This browser copy holds 500 mailbox records. That is a storage guard, not a Gmail limit." };
  const row: MailboxAccount = { id: nid("mail"), label: label.trim().slice(0, 80) || email, address: email, status: "not_connected" };
  return { ok: true, ws: { ...ws, mailboxes: [row, ...ws.mailboxes] } };
}

export function gmailConnectAttempt(): { ok: false; error: string } {
  return { ok: false, error: "Google OAuth is not configured. No mailbox was connected and no message was read or sent." };
}

export function addSchedule(ws: Workspace, name: string, agentId: string | null, intervalMinutes: number, now?: string, timeZone = "UTC", clockHour: number | null = null, clockMinute = 0, instruction?: string): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const title = name.trim().slice(0, 80);
  if (!title) return { ok: false, error: "Name the schedule." };
  if (instruction !== undefined && (!instruction.trim() || instruction.trim().length > 2000)) return { ok: false, error: "Enter a task instruction of 1 to 2,000 characters." };
  if (clockHour != null && (!Number.isInteger(clockHour) || clockHour < 0 || clockHour > 23)) return { ok: false, error: "Enter a whole hour from 0 to 23." };
  if (clockHour != null && !zoneIsValid(timeZone)) return { ok: false, error: "Enter a valid time zone." };
  if (agentId && !ws.agents.some((agent) => agent.id === agentId && !agent.archived)) return { ok: false, error: "Choose an active bot." };
  const at = stamp(now);
  const minutes = Math.min(10_080, Math.max(5, intervalMinutes || 1440));
  const hour = clockHour == null ? null : Math.min(23, Math.max(0, Math.floor(clockHour)));
  const minute = Math.min(59, Math.max(0, Math.floor(clockMinute)));
  const clock = hour == null ? null : nextClock(at, timeZone, hour, minute);
  const job: ScheduleJob = {
    id: nid("job"),
    name: title,
    instruction: instruction?.trim(),
    agentId,
    intervalMinutes: minutes,
    nextRunAt: clock?.at ?? at,
    lastRunAt: null,
    resultDelivery: "runs",
    overlapPolicy: "queue",
    occurrences: [],
    enabled: true,
    lastError: clock ? "" : "",
    timeZone: clock?.zone ?? "UTC",
    clockHour: hour,
    clockMinute: hour == null ? null : minute,
    leaseWorker: null,
    leaseUntil: null,
    lastStatus: "",
    timing: "fixed_rate",
    missedPolicy: "latest",
    missedOccurrences: 0,
    executionEnvironment: "device",
  };
  return { ok: true, ws: { ...ws, schedules: [job, ...ws.schedules] } };
}

export function setScheduleEnabled(ws: Workspace, id: string, enabled: boolean, now = stamp(), runMissed = false): Workspace {
  return { ...ws, schedules: ws.schedules.map((job) => {
    if (job.id !== id || job.enabled === enabled) return job;
    let nextRunAt = job.nextRunAt;
    if (enabled && !runMissed && nextRunAt <= now) {
      nextRunAt = job.clockHour == null ? new Date(Date.parse(now) + job.intervalMinutes * 60_000).toISOString()
        : nextClock(now, job.timeZone, job.clockHour, job.clockMinute ?? 0).at;
    }
    return { ...job, enabled, nextRunAt, recoveryPending: false, recoveryApprovalFor: enabled && runMissed ? nextRunAt : undefined };
  }) };
}

export function deployAgent(ws: Workspace, agentId: string, target: "local-worker" | "hosted-worker", now?: string): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const agent = ws.agents.find((item) => item.id === agentId && !item.archived);
  if (!agent) return { ok: false, error: "That agent is not on this device." };
  const at = stamp(now);
  const record: DeploymentRecord = target === "local-worker"
    ? { id: nid("dep"), agentId, agentVersion: agent.version, target, state: "local-ready", workerId: "browser-worker", heartbeatAt: at, error: "" }
    : { id: nid("dep"), agentId, agentVersion: agent.version, target, state: "external-required", workerId: null, heartbeatAt: null, error: "No hosted worker is provisioned. This record does not start a remote process." };
  return { ok: true, ws: { ...ws, deployments: [record, ...ws.deployments.filter((item) => item.agentId !== agentId)] } };
}

export function enqueueRun(ws: Workspace, agentId: string, goal: string, now?: string, parentId: string | null = null, depth = 0, runId = nid("run")): { ok: true; ws: Workspace; run: AgentRun } | { ok: false; error: string } {
  if (ws.halted) return { ok: false, error: "Emergency stop is on. No new action can run." };
  const agent = ws.agents.find((item) => item.id === agentId && !item.archived);
  if (!agent) return { ok: false, error: "That agent is not on this device." };
  if (goal.trim().length > 2000) return { ok: false, error: "The task exceeds 2,000 characters. Shorten it before queueing; nothing was truncated or queued." };
  const text = goal.trim();
  if (!text) return { ok: false, error: "Write what the agent should do." };
  if (ws.runs.length >= 200) return { ok: false, error: "Too many runs are stored on this device." };
  const at = stamp(now);
  const run: AgentRun = {
    id: runId,
    agentId,
    parentId,
    depth: depth === 1 ? 1 : 0,
    goal: text,
    state: "queued",
    step: 0,
    maxSteps: agent.maxSteps,
    workerId: null,
    leaseUntil: null,
    approvedActions: [],
    agentVersion: agent.version,
    execution: { provider: agent.chatProvider || null, tier: agent.chatTier || null, instructions: agent.instructions, knowledge: agent.knowledge || "", projectId: agent.projectId, memory: agent.memory },
    configuration: configurationOf(agent),
    stepResults: [],
    approvalHistory: [],
    verification: { state: "unverified", detail: "The requested objective has not been verified." },
    plan: buildTaskPlan(text, agent.tools),
    definition: snapshotDefinition(agent),
    executionRuntime: runId.startsWith("scheduled:") ? "scheduled-local" : "browser-local",
    result: "",
    error: "",
    createdAt: at,
    updatedAt: at,
  };
  const fleet = readFleet(ws);
  event(fleet, run.id, at, "task_created", `Queued ${agent.name}.`);
  return { ok: true, run, ws: withFleet(ws, { ...fleet, runs: [run, ...fleet.runs] }) };
}

export function reviewedRunOperation(run: AgentRun, agent: AgentDefinition): string {
  return JSON.stringify({ run: run.id, agent: run.agentId, agentVersion: agent.version, pinnedVersion: run.agentVersion, step: run.step, tool: run.plan[run.step]?.tool, goal: run.goal, destination: quoteUrl(run.goal), projectId: agent.projectId, memory: agent.memory, approval: agent.approval, tools: agent.tools, chatId: run.chatId, scheduleId: run.scheduleId });
}

export function runOperationFingerprint(run: AgentRun, agent: AgentDefinition): string {
  return JSON.stringify({ runId: run.id, agentId: agent.id, agentVersion: agent.version, projectId: agent.projectId, goal: run.goal, planVersion: run.planVersion ?? 0, plan: run.plan, step: run.step });
}

export function enqueueConfiguredRun(ws: Workspace, agentId: string, goal: string, inputs?: Partial<Record<FleetTool, PlanStep["input"]>>, now?: string): ReturnType<typeof enqueueRun> {
  const agent = ws.agents.find(item => item.id === agentId);
  if (agent?.tools.includes("model") && !agent.chatProvider) return { ok: false, error: "Select a connected answer provider in this bot's configuration before queueing a model step." };
  for (const tool of ["gmail_read", "gmail_send"] as const) {
    if (!agent?.tools.includes(tool)) continue;
    const input = inputs?.[tool];
    if (!input?.accountId || !EMAIL.test(input.accountId) || !input.connectionVersion) return { ok: false, error: "Select the current connected Gmail account before queueing this step." };
    if (tool === "gmail_send" && (!input.recipients?.length || input.recipients.length > 50 || input.recipients.some(recipient => !EMAIL.test(recipient) || /[\r\n<>;,]/.test(recipient)) || !input.body?.trim() || input.body.length > 8000 || (input.subject?.length ?? 0) > 1000 || /[\r\n]/.test(input.subject ?? ""))) return { ok: false, error: "Review the recipients, subject and message (up to 8,000 characters). Nothing was queued." };
  }
  const made = enqueueRun(ws, agentId, goal, now);
  if (!made.ok) return made;
  const run = { ...made.run, plan: made.run.plan.map(step => ({ ...step, ...(inputs?.[step.tool] ? { input: { ...inputs[step.tool], ...(inputs[step.tool]?.recipients ? { recipients: [...inputs[step.tool]!.recipients!] } : {}) } } : {}) })) };
  return { ...made, run, ws: { ...made.ws, runs: made.ws.runs.map(item => item.id === run.id ? run : item) } };
}

export function approveRunAction(ws: Workspace, runId: string, actionId: string, now = stamp()): Workspace {
  if (ws.halted) return ws;
  return { ...ws, runs: ws.runs.map((run) => {
    const pending = run.pendingApproval;
    const agent = ws.agents.find((item) => item.id === run.agentId && !item.archived);
    const step = run.plan[run.step];
    if (run.id !== runId || run.state !== "waiting_approval" || !pending || pending.state !== "requested" || pending.id !== actionId || !agent || !step) return run;
    if (pending.expiresAt <= now || pending.binding !== actionBinding(run, agent, step)) {
      return { ...run, pendingApproval: { ...pending, state: pending.expiresAt <= now ? "expired" as const : "superseded" as const, updatedAt: now }, state: "queued" as const, error: "The reviewed action expired or changed. Review the new request before it runs.", updatedAt: now };
    }
    return { ...run, approvedActions: [], pendingApproval: { ...pending, state: "granted" as const, updatedAt: now }, state: "queued" as const, error: "", updatedAt: now };
  }) };
}

export function assignDelegation(ws: Workspace, runId: string, index: number, agentId: string): Workspace {
  if (ws.halted) return ws;
  return { ...ws, runs: ws.runs.map((run) => {
    if (run.id !== runId || run.depth > 0 || run.step > 0 || run.state !== "queued") return run;
    const chosen = ws.agents.find((item) => item.id === agentId && !item.archived);
    if (!chosen) return run;
    const goals = delegationGoals(run.goal);
    if (!goals[index]) return run;
    const assignments = goals.map((goal, i) => run.delegations?.[i] || { agentId: run.agentId, goal, allowedTools: run.plan.map((step) => step.tool).filter((tool) => tool !== "delegate"), maxSteps: run.maxSteps });
    assignments[index] = { agentId, goal: goals[index], allowedTools: chosen.tools.filter((tool) => tool !== "delegate"), maxSteps: Math.min(run.maxSteps, chosen.maxSteps) };
    return { ...run, delegations: assignments, approvedActions: [] };
  }) };
}

export function revokeRunApproval(ws: Workspace, runId: string, now = stamp()): Workspace {
  return { ...ws, runs: ws.runs.map((run) => run.id === runId && run.pendingApproval && ["requested", "granted"].includes(run.pendingApproval.state)
    ? { ...run, pendingApproval: { ...run.pendingApproval, state: "revoked", updatedAt: now }, approvedActions: [], state: "paused", updatedAt: now, error: "Authorization revoked. Resume to request a new review." }
    : run) };
}

/** A batch authorizes only the exact pending requests shown in its review. */
export function approveRunBatch(ws: Workspace, requests: { runId: string; approvalId: string }[], projectId: string | null, maximum: number, now = stamp()): { ok: true; ws: Workspace; batchId: string } | { ok: false; error: string } {
  if (ws.halted || !Number.isInteger(maximum) || maximum < 1 || maximum > 50 || requests.length < 1 || requests.length > maximum || new Set(requests.map(item => item.runId)).size !== requests.length) return { ok: false, error: "Review between one and fifty distinct operations within the selected batch limit." };
  let next = ws;
  const batchId = nid("authorization-batch");
  for (const request of requests) {
    const before = next.runs.find(run => run.id === request.runId);
    if (!before || before.configuration?.projectId !== projectId) return { ok: false, error: "Every operation in a batch must belong to the reviewed project scope. Nothing was authorized." };
    next = approveRunAction(next, request.runId, request.approvalId, now);
    const granted = next.runs.find(run => run.id === request.runId);
    if (granted?.pendingApproval?.state !== "granted" || granted.pendingApproval.id !== request.approvalId) return { ok: false, error: "A reviewed operation changed or expired. Nothing in the batch was authorized." };
    next = { ...next, runs: next.runs.map(run => run.id === request.runId ? { ...run, pendingApproval: { ...run.pendingApproval!, batchId } } : run) };
  }
  return { ok: true, ws: next, batchId };
}

export function selectDelegatedAgent(agents: AgentDefinition[], parent: AgentDefinition, goal: string): AgentDefinition {
  const words = new Set(goal.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const wanted: FleetTool[] = /\b(search|research|sources)\b/i.test(goal) ? ["web_search", "search_notes"]
    : /\b(inbox|mail|email)\b/i.test(goal) ? ["gmail_read"] : /\b(analy[sz]e|reason|write)\b/i.test(goal) ? ["model"] : [];
  const eligible = agents.filter(agent => agent.id !== parent.id && !agent.archived && agent.projectId === parent.projectId
    && (parent.memory === "on" || agent.memory === "off") && agent.tools.some(tool => tool !== "delegate")
    && agent.tools.every(tool => tool !== "delegate" && parent.tools.includes(tool))
    && (!agent.tools.includes("model") || (agent.chatProvider === parent.chatProvider && agent.chatTier === parent.chatTier)));
  const score = (agent: AgentDefinition) => [...new Set(`${agent.name} ${agent.role}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter(word => words.has(word)).length * 4 + wanted.filter(tool => agent.tools.includes(tool)).length * 5;
  return eligible.map(agent => ({ agent, score: score(agent) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.agent.tools.length - b.agent.tools.length || a.agent.id.localeCompare(b.agent.id))[0]?.agent ?? parent;
}

/** Clear only explicitly selected terminal records; unresolved dispatches and active parents retain evidence. */
export function clearFinishedRuns(ws: Workspace, ids: string[]): Workspace {
  const selected = new Set(ids);
  const active = new Set(ws.runs.filter(run => !TERMINAL.has(run.state)).map(run => run.id));
  const removed = new Set(ws.runs.filter(run => selected.has(run.id) && TERMINAL.has(run.state) && run.externalOperation?.state !== "unknown" && run.externalOperation?.state !== "dispatching" && (!run.parentId || !active.has(run.parentId))).map(run => run.id));
  return { ...ws,
    runs: ws.runs.filter(run => !removed.has(run.id)),
    runEvents: ws.runEvents.filter(event => !removed.has(event.runId)),
    browserSessions: ws.browserSessions.filter(session => !session.runId || !removed.has(session.runId)),
    schedules: ws.schedules.map(job => job.lastQueuedRunId && removed.has(job.lastQueuedRunId) ? { ...job, lastQueuedRunId: undefined } : job),
  };
}

export function pauseRun(ws: Workspace, runId: string): Workspace {
  return { ...ws, runs: ws.runs.map((run) => (run.id === runId && canTransition(run.state, "paused") ? { ...run, state: "paused", updatedAt: stamp() } : run)) };
}

export function resumeRun(ws: Workspace, runId: string): Workspace {
  if (ws.halted) return ws;
  return { ...ws, runs: ws.runs.map((run) => (run.id === runId && (run.state === "paused" || run.state === "waiting_external") && canTransition(run.state, "queued") ? { ...run, state: "queued", updatedAt: stamp() } : run)) };
}

export function cancelRun(ws: Workspace, runId: string, now?: string): Workspace {
  const at = stamp(now);
  const fleet = readFleet(ws);
  const runs = fleet.runs.map((run) => {
    if ((run.id !== runId && run.parentId !== runId) || !canTransition(run.state, "canceled")) return run;
    event(fleet, run.id, at, "canceled", "Stopped. Unfinished work was not marked complete.");
    return { ...run, state: "canceled" as const, error: "Stopped.", updatedAt: at, leaseUntil: null, approvedActions: [], pendingApproval: run.pendingApproval ? { ...run.pendingApproval, state: "revoked" as const, updatedAt: at } : undefined };
  });
  return withFleet(ws, { ...fleet, runs });
}

export function haltFleet(ws: Workspace, now?: string): Workspace {
  const at = stamp(now);
  const fleet = readFleet(ws);
  const runs = fleet.runs.map((run) => {
    if (TERMINAL.has(run.state)) return run;
    event(fleet, run.id, at, "emergency_stop", "Emergency stop canceled this run.");
    return { ...run, state: "canceled" as const, error: "Emergency stop is on.", updatedAt: at, leaseUntil: null, approvedActions: [], pendingApproval: run.pendingApproval ? { ...run.pendingApproval, state: "revoked" as const, updatedAt: at } : undefined };
  });
  return withFleet(ws, { ...fleet, runs });
}

export type BrowserReadObjective = { url: string; goal: string; capability: "read_page" };

export type TickEnv = {
  runtime?: AgentRun["executionRuntime"];
  now: string;
  workerId: string;
  browser?: (url: string, objective: { goal: string; capability: "read_page" }) => { ok: true; title: string; excerpt: string } | { ok: false; error: string };
  search?: (query: string) => { ok: boolean; citations: { id?: string; title: string; url: string; excerpt?: string }[]; error: string };
  /** Adapters must resolve owner credentials and validate capabilities before dispatch. */
  model?: (request: FleetExternalRequest) => { ok: true; text: string; provider: string; model: string } | { ok: false; error: string };
  gmail?: (request: FleetExternalRequest & { action: "gmail_read" | "gmail_send"; accountId: string }) => { ok: true; text: string; accountId: string; operationId: string } | { ok: false; error: string };
  verify?: (run: AgentRun) => { met: boolean; detail: string };
  environment?: "browser" | "local-worker" | "hosted-worker";
};

export type FleetExternalRequest = {
  runId: string; stepId: string; goal: string; instructions: string; projectId?: string | null; taskId?: string;
  provider: string | null; modelTier: ModelTier | null;
  results: FleetStepResult[]; input: PlanStep["input"];
};

function finish(run: AgentRun, state: RunState, at: string, error = ""): AgentRun {
  return { ...run, state, error, updatedAt: at, leaseUntil: null, workerId: null };
}

function advanceWithResult(run: AgentRun, detail: string): AgentRun {
  const full = [run.result, detail].filter(Boolean).join("\n");
  const marker = "\n[Result excerpt truncated]";
  const result = full.length <= 4000 ? full : full.slice(0, 4000 - marker.length) + marker;
  return { ...run, result, step: run.step + 1 };
}

function quoteUrl(goal: string) {
  const urls = [...new Set(goal.split(/\s+/).filter((part) => HTTP.test(part)))];
  if (urls.length !== 1) return "";
  try {
    const parsed = new URL(urls[0]!);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
}

function destinationFor(run: AgentRun, step: PlanStep): string {
  if (step.tool === "browser") return quoteUrl(step.input?.url ?? run.goal);
  if (step.tool === "gmail_read" || step.tool === "gmail_send") return `${step.input?.accountId ?? "No account selected"}${step.tool === "gmail_send" ? ` → ${(step.input?.recipients ?? []).join(", ")}` : ""}`;
  if (step.tool === "model") return run.configuration?.chatProvider ?? "No provider selected";
  return run.configuration?.projectId ?? "Permitted workspace records";
}

function actionBinding(run: AgentRun, agent: AgentDefinition, step: PlanStep): string {
  return JSON.stringify({ runId: run.id, agentId: agent.id, configuration: configurationOf(agent), step: run.step, operation: step, goal: run.goal, destination: destinationFor(run, step) });
}

function requestApproval(run: AgentRun, agent: AgentDefinition, step: PlanStep, at: string): AgentRun {
  const previous = run.pendingApproval;
  const history = previous ? [...(run.approvalHistory ?? []), { ...previous, state: previous.expiresAt <= at ? "expired" as const : previous.state === "granted" ? "superseded" as const : previous.state, updatedAt: at }].slice(-40) : run.approvalHistory ?? [];
  return finish({ ...run, approvedActions: [], approvalHistory: history, pendingApproval: {
    id: nid("approval"), tool: step.tool, stepId: step.id, binding: actionBinding(run, agent, step),
    destination: destinationFor(run, step), requestedAt: at, expiresAt: new Date(Date.parse(at) + RUN_APPROVAL_TTL_MS).toISOString(), state: "requested", updatedAt: at,
  } }, "waiting_approval", at, "Review this exact action before it runs. Authorization lasts five minutes and is used once.");
}

function consumeApproval(run: AgentRun, at: string): AgentRun {
  if (!run.pendingApproval || run.pendingApproval.state !== "granted") return run;
  return { ...run, approvedActions: [], approvalHistory: [...(run.approvalHistory ?? []), { ...run.pendingApproval, state: "consumed" as const, updatedAt: at }].slice(-40), pendingApproval: undefined };
}

function recordStep(run: AgentRun, step: PlanStep, at: string, text: string, sources: FleetStepResult["sources"] = [], empty = false, receipt?: FleetStepResult["receipt"], recordIds: string[] = []): AgentRun {
  const result: FleetStepResult = { recordIds, output: text.slice(0, 4000), id: `${run.id}:${step.id}`, stepId: step.id, tool: step.tool, at, status: empty ? "empty" : "success", text: text.slice(0, RUN_EVIDENCE_MAX_CHARS), originalLength: text.length, truncated: text.length > RUN_EVIDENCE_MAX_CHARS, sources: sources.slice(0, 30), receipt };
  return advanceWithResult({ ...run, stepResults: [...(run.stepResults ?? []).filter((item) => item.stepId !== step.id), result] }, text);
}

function validRunPlan(run: AgentRun, agent: AgentDefinition): boolean {
  const seen = new Set<string>();
  return run.plan.length > 0 && run.plan.every((step) => {
    if (!step.id || seen.has(step.id) || !agent.tools.includes(step.tool) || (run.configuration && !run.configuration.tools.includes(step.tool)) || (run.delegationScope && !run.delegationScope.tools.includes(step.tool)) || step.dependsOn.some(id => !seen.has(id))) return false;
    seen.add(step.id);
    return true;
  });
}

export function tickFleet(ws: Workspace, env: TickEnv): Workspace {
  const fleet = readFleet(ws);
  const at = env.now;
  if (ws.halted) return haltFleet(ws, at);
  const extra: AgentRun[] = [];
  let processed = 0;
  const runs = fleet.runs.map((run) => {
    const scheduled = fleet.schedules.find(job => job.id === run.scheduleId || run.id.startsWith(`scheduled:${job.id}:`) || run.parentId?.startsWith(`scheduled:${job.id}:`));
    if (scheduled && (scheduled.executionTarget ?? "browser") !== (env.environment ?? "browser")) return run;
    if (processed >= 4 || TERMINAL.has(run.state) || run.state === "paused" || run.state === "waiting_external") return run;
    if (run.externalOperation?.state === "dispatching" || run.externalOperation?.state === "unknown") return run;
    if (run.state === "waiting_approval" && !run.pendingApproval) return run;
    if (run.state === "waiting_approval" && run.pendingApproval?.state === "requested" && run.pendingApproval.expiresAt > at) return run;
    if (run.leaseUntil && run.leaseUntil > at && run.workerId && run.workerId !== env.workerId) return run;
    processed += 1;
    const agent = fleet.agents.find((item) => item.id === run.agentId);
    if (!agent || agent.archived) {
      const reason = agent ? "This bot was archived before the run could finish." : "The agent definition is gone.";
      event(fleet, run.id, at, "failed", reason);
      return finish(run, "failed", at, reason);
    }
    // Legacy records acquire a snapshot before further execution. They never inherit a legacy grant.
    let claimed: AgentRun = { ...run, configuration: run.configuration ?? configurationOf(agent), approvedActions: [], state: "running", workerId: env.workerId, leaseUntil: new Date(Date.parse(at) + 30_000).toISOString(), updatedAt: at };
    const fail = (error: string, state: RunState = "failed") => {
      event(fleet, claimed.id, at, state, error);
      return finish(claimed, state, at, error);
    };
    if (!validRunPlan(claimed, agent)) return fail("The saved plan is invalid or requests a capability this agent no longer has. Queue a reviewed replacement.");
    const currentConfiguration = configurationOf(agent);
    // A queued plan pins step order. Permission checks compare the capability set.
    const pinned = claimed.configuration!;
    if (JSON.stringify({ ...pinned, tools: [...pinned.tools].sort() }) !== JSON.stringify({ ...currentConfiguration, tools: [...currentConfiguration.tools].sort() })) return fail("The agent configuration changed after this run was queued. Queue a new run with the reviewed configuration.");
    if (claimed.delegationScope && (agent.projectId !== claimed.delegationScope.projectId || (agent.memory === "on" && claimed.delegationScope.memory !== "on"))) return fail("The child agent's resource scope exceeds its delegation grant. Nothing was dispatched.");
    if (claimed.step >= claimed.plan.length) {
      if (!(claimed.stepResults?.length)) return fail("Execution ended without a confirmed tool result. The objective was not verified.");
      let verification: AgentRun["verification"] = { state: "unverified", detail: "Execution steps finished. The requested objective still needs verification." };
      if (env.verify) {
        try {
          const checked = env.verify(claimed);
          verification = { state: checked.met ? "verified" : "not_met", detail: checked.detail.slice(0, 500) };
        } catch { return fail("Objective verification failed. Tool results were retained; the objective was not marked verified."); }
      }
      event(fleet, claimed.id, at, verification.state === "not_met" ? "failed" : "completed", verification.detail);
      return finish({ ...claimed, verification }, verification.state === "not_met" ? "failed" : "completed", at, verification.state === "not_met" ? verification.detail : "");
    }
    if (claimed.step >= claimed.maxSteps) return fail("The step limit was reached with unfinished plan steps. Partial results were retained.");
    const step = claimed.plan[claimed.step]!;
    const tool = step.tool;
    if (step.dependsOn.some(id => !claimed.stepResults?.some(result => result.stepId === id))) return fail("A required prior step has no confirmed result. This step was not dispatched.");
    const dependent = step.inputFrom && claimed.stepResults?.find(result => result.stepId === step.inputFrom!.stepId);
    const stepQuery = step.inputFrom ? (step.inputFrom.field === "recordIds" ? dependent?.recordIds?.join(" ") : dependent?.text) : claimed.goal;
    if (!stepQuery || (step.inputFrom && !step.dependsOn.includes(step.inputFrom.stepId))) return fail("A required step result is missing. The dependent operation was not dispatched.");
    if (tool === "browser" && !destinationFor(claimed, step)) return fail("Choose one exact http(s) URL before requesting browser approval. No page was opened.");
    const requiresReview = tool === "browser" || tool === "gmail_read" || tool === "gmail_send" || tool === "model" || (agent.approval === "ask" && tool !== "delegate");
    if (requiresReview) {
      const grant = claimed.pendingApproval;
      if (!grant || grant.state !== "granted" || grant.expiresAt <= at || grant.binding !== actionBinding(claimed, agent, step)) {
        const requested = requestApproval(claimed, agent, step, at);
        event(fleet, claimed.id, at, "approval_requested", `${tool}: ${requested.pendingApproval!.destination}. Nothing was dispatched.`);
        return requested;
      }
    }
    if (tool === "delegate") {
      if (claimed.depth >= 1) return fail("Delegated runs cannot delegate again.");
      const kids = [...fleet.runs, ...extra].filter((item) => item.parentId === claimed.id);
      if (kids.length === 0) {
        const goals = delegationGoals(claimed.goal);
        const childPlan = buildTaskPlan(claimed.goal, agent.tools.filter(item => item !== "delegate"));
        if (!childPlan.length) return fail("Delegation has no permitted child capability. Choose a read or analysis tool before queueing.");
        if (fleet.runs.length + extra.length + goals.length > 200) return fail("Delegation would exceed the saved run limit. Export and clear finished history before queueing a replacement.");
        for (const part of goals) {
          const specialist = selectDelegatedAgent(fleet.agents, agent, part);
          const child: AgentRun = {
            ...claimed, id: nid("run"), parentId: claimed.id, depth: 1, goal: part, state: "queued", step: 0,
            agentId: specialist.id, configuration: configurationOf(specialist), maxSteps: specialist.maxSteps,
            delegationScope: { tools: agent.tools.filter(item => item !== "delegate"), projectId: agent.projectId, memory: agent.memory },
            workerId: null, leaseUntil: null, result: "", error: "", createdAt: at, updatedAt: at,
            approvedActions: [], pendingApproval: undefined, approvalHistory: [], stepResults: [],
            verification: { state: "unverified", detail: "The delegated objective has not been verified." },
            plan: buildTaskPlan(part, specialist.tools.filter(item => item !== "delegate")),
          };
          extra.push(child);
          event(fleet, child.id, at, "task_created", "Delegated within the parent capability and project scope. No parent approval was inherited.");
        }
        event(fleet, claimed.id, at, "plan_generated", JSON.stringify(goals));
        event(fleet, claimed.id, at, "delegated", `Delegated ${goals.length} child runs with the parent's capability ceiling.`);
        return claimed;
      }
      if (kids.some(item => !TERMINAL.has(item.state))) return claimed;
      const detail = kids.map(item => item.result || item.error || item.state).join(" | ");
      if (kids.some(child => child.state !== "completed")) return fail(kids.map(child => `${child.id}: ${child.state}`).join(", "), kids.every(child => child.state === "canceled") ? "canceled" : "failed");
      event(fleet, claimed.id, at, "tool_result", detail);
      return recordStep(claimed, step, at, detail);
    }
    if (LOCAL.has(tool)) {
      const local = tool as LocalTool;
      const scope = {
        ...ws,
        projects: agent.projectId ? ws.projects.filter(project => project.id === agent.projectId) : ws.projects,
        chats: (agent.projectId ? ws.chats.filter(chat => chat.projectId === agent.projectId) : ws.chats).filter(chat => !chat.temporary),
        memories: agent.memory === "on" ? ws.memories.filter(note => note.scope === "global" || (note.scope === "project" && !!agent.projectId && note.projectId === agent.projectId)) : [],
      };
      claimed = consumeApproval(claimed, at);
      const executed = runLocalPlan(scope, [{ id: local, tool: local, query: stepQuery }], { autonomy: agent.approval, halted: ws.halted, tokens: requiresReview ? { [local]: `approve:${local}` } : {} });
      const detail = executed.lines.join(" ");
      if (!executed.ok) return fail(detail);
      event(fleet, claimed.id, at, "tool_result", detail);
      return recordStep(claimed, step, at, detail, [], false, undefined, executed.results.flatMap(result => result.records.map(record => record.id)));
    }
    // Exception boundaries are per operation: another queued run still receives its turn.
    if (tool === "web_search") {
      if (!env.search) return fail("No search provider is configured. Nothing was searched and no citations were created.", "waiting_external");
      claimed = consumeApproval(claimed, at);
      try {
        const result = env.search(stepQuery);
        if (!result.ok) return fail(result.error || "Search failed. No successful result was recorded.", "waiting_external");
        const sources = result.citations.slice(0, 30).map((item, index) => ({ id: item.id ?? `${claimed.id}:${step.id}:source-${index + 1}`, title: item.title.slice(0, 300), url: item.url.slice(0, 2000), ...(item.excerpt ? { excerpt: item.excerpt.slice(0, 2000) } : {}) }));
        const detail = sources.length ? sources.map(item => `${item.title} ${item.url}${item.excerpt ? `\n${item.excerpt}` : ""}`).join("\n\n") : "Search completed with no matching sources.";
        event(fleet, claimed.id, at, "tool_result", detail);
        return recordStep(claimed, step, at, detail, sources, sources.length === 0);
      } catch { return fail("The search adapter threw an exception. No search result was confirmed; other runs can continue."); }
    }
    if (tool === "browser") {
      if (!env.browser) return fail("No browser driver is attached. No page was opened.", "waiting_external");
      const url = destinationFor(claimed, step);
      claimed = consumeApproval(claimed, at);
      try {
        const opened = env.browser(url, { goal: stepQuery, capability: "read_page" });
        const evidenceId = `${claimed.id}:${step.id}`;
        fleet.browserSessions.unshift({ id: nid("tab"), runId: claimed.id, url, title: opened.ok ? opened.title : "", status: opened.ok ? "open" : "failed", lastAction: opened.ok ? "Read the page. No page interaction was requested. Extraction is retained with the run." : opened.error, excerpt: opened.ok ? opened.excerpt.slice(0, 500) : "", excerptTruncated: opened.ok && opened.excerpt.length > 500, evidenceId: opened.ok ? evidenceId : undefined, updatedAt: at });
        if (!opened.ok) return fail(opened.error);
        const detail = `${opened.title} ${url}\n${opened.excerpt}`;
        event(fleet, claimed.id, at, "tool_result", detail);
        return recordStep(claimed, step, at, detail, [{ id: evidenceId, title: opened.title, url }]);
      } catch { return fail("The browser adapter threw after dispatch. Its outcome is unknown; inspect the browser before starting a replacement run."); }
    }
    const request: FleetExternalRequest = { runId: claimed.id, stepId: step.id, goal: claimed.goal, instructions: agent.instructions, projectId: agent.projectId, taskId: claimed.parentId ?? claimed.id, provider: agent.chatProvider ?? null, modelTier: agent.chatTier ?? null, results: claimed.stepResults ?? [], input: step.input };
    if (tool === "gmail_read" || tool === "gmail_send") {
      if (!env.gmail) return fail("No Gmail execution adapter is attached to this worker. Nothing was read or sent.", "waiting_external");
      if (!step.input?.accountId) return fail("Select the exact Gmail account for this operation. Nothing was read or sent.");
      if (tool === "gmail_send" && (!step.input.recipients?.length || step.input.recipients.some(recipient => !EMAIL.test(recipient)) || !step.input.body?.trim())) return fail("Review valid recipients and the exact message before sending. Nothing was sent.");
      claimed = consumeApproval(claimed, at);
      try {
        const outcome = env.gmail({ ...request, action: tool, accountId: step.input.accountId });
        if (!outcome.ok) return fail(outcome.error);
        if (outcome.accountId !== step.input.accountId || !outcome.operationId) return fail("The Gmail adapter did not confirm the selected account and operation. Reconcile its outcome before another attempt.");
        event(fleet, claimed.id, at, "tool_result", outcome.text);
        return recordStep(claimed, step, at, outcome.text, [], false, { accountId: outcome.accountId, operationId: outcome.operationId });
      } catch { return fail("The Gmail adapter threw after dispatch. Its outcome is unknown; reconcile the selected mailbox before another attempt."); }
    }
    if (!env.model) return fail("This worker does not call a model without an attached adapter. Nothing was sent.", "waiting_external");
    if (!request.provider) return fail("Select a provider for this agent before model execution. Nothing was sent.");
    claimed = consumeApproval(claimed, at);
    try {
      const outcome = env.model(request);
      if (!outcome.ok) return fail(outcome.error);
      if (outcome.provider !== request.provider || !outcome.model || !outcome.text.trim()) return fail("The model adapter did not return a valid answer with the selected provider identity. No fallback was accepted.");
      event(fleet, claimed.id, at, "tool_result", `${outcome.provider} · ${outcome.model}: ${outcome.text}`);
      return recordStep(claimed, step, at, outcome.text, [], false, { provider: outcome.provider, model: outcome.model });
    } catch { return fail("The model adapter threw after dispatch. A billable outcome may be unknown; inspect the provider receipt before retrying."); }
  });
  let chats = ws.chats;
  let scheduleChanged = false;
  const schedules = fleet.schedules.map(job => {
    const occurrences = (job.occurrences ?? []).map((occurrence) => {
      const outcome = runs.find((run) => run.id === occurrence.runId);
      if (!outcome) return occurrence;
      let next = occurrence;
      if (outcome.state !== occurrence.state || outcome.updatedAt !== occurrence.updatedAt) {
        next = { ...occurrence, state: outcome.state, updatedAt: outcome.updatedAt, detail: (outcome.error || outcome.result).slice(0, 500) };
        scheduleChanged = true;
      }
      if (job.resultDelivery !== "conversation" || outcome.state !== "completed" || next.deliveredAt || next.deliveryError) return next;
      scheduleChanged = true;
      const chat = chats.find((item) => item.id === next.destinationChatId && item.id === job.chatId && !item.archived && !item.temporary);
      if (!chat) return { ...next, deliveryError: "The original conversation is unavailable or changed. The result remains in Runs." };
      const messageId = "scheduled-result:" + next.id;
      if (!chat.messages.some((message) => message.id === messageId)) {
        chats = chats.map((item) => item.id === chat.id ? { ...item, messages: [...item.messages, {
          id: messageId, at, role: "assistant" as const, content: outcome.result || "The scheduled task completed without text output.",
          provider: "Local workflow", model: "scheduled result",
        }] } : item);
      }
      return { ...next, deliveredAt: at };
    });
    job = { ...job, occurrences };
    if (!job.lastQueuedRunId) return job;
    const run = runs.find(item => item.id === job.lastQueuedRunId);
    if (!run || !TERMINAL.has(run.state)) return job;
    scheduleChanged ||= run.state === "completed"
      ? job.lastRunAt !== run.updatedAt || job.lastStatus !== "ran"
      : job.lastStatus !== "failed" || job.lastError !== (run.error || run.state);
    return run.state === "completed"
      ? { ...job, lastRunAt: run.updatedAt, lastStatus: "ran" as const, lastError: "", lastVerification: run.verification?.state ?? "unverified" as const }
      : { ...job, lastStatus: "failed" as const, lastError: run.error || run.state, lastVerification: run.verification?.state ?? "not_met" as const };
  });
  if (!processed && !extra.length && !scheduleChanged) return ws;
  return withFleet({ ...ws, chats }, { ...fleet, schedules, runs: [...extra, ...runs] });
}

export function scheduleExecutionStatus(job: ScheduleJob, now = new Date().toISOString()): string {
  if (!job.enabled) return "Disabled";
  const target = job.executionTarget || "browser";
  if (target === "browser") return "Enabled · requires this app open and synchronized";
  const heartbeat = Date.parse(job.workerHeartbeatAt || "");
  return Number.isFinite(heartbeat) && Date.parse(now) - heartbeat < 120_000 ? `Enabled · worker ${job.workerId || target} recently checked` : `Enabled · no recent ${target} heartbeat; execution availability is unverified`;
}

function nextOccurrence(job: ScheduleJob, after: string): string {
  return job.clockHour == null ? new Date(Date.parse(after) + job.intervalMinutes * 60_000).toISOString() : nextClock(after, job.timeZone || "UTC", job.clockHour, job.clockMinute ?? 0, after).at;
}

export function setSchedulePolicy(ws: Workspace, id: string, policy: {
  missedPolicy?: NonNullable<ScheduleJob["missedPolicy"]>;
  overlapPolicy?: NonNullable<ScheduleJob["overlapPolicy"]>;
  resultDelivery?: NonNullable<ScheduleJob["resultDelivery"]>;
}): Workspace {
  if (ws.halted) return ws;
  return { ...ws, schedules: ws.schedules.map((job) => job.id === id ? { ...job,
    ...(policy.missedPolicy && ["once", "skip", "review"].includes(policy.missedPolicy) ? { missedPolicy: policy.missedPolicy } : {}),
    ...(policy.overlapPolicy && ["wait", "skip", "parallel"].includes(policy.overlapPolicy) ? { overlapPolicy: policy.overlapPolicy } : {}),
    ...(policy.resultDelivery && ["runs", "conversation"].includes(policy.resultDelivery) ? { resultDelivery: policy.resultDelivery, occurrences: job.occurrences?.map((occurrence) => ({ ...occurrence, deliveryError: undefined })) } : {}),
  } : job) };
}

export function configureSchedulePolicy(ws: Workspace, id: string, policy: { timing?: ScheduleTiming; missedPolicy?: MissedSchedulePolicy }): Workspace {
  return { ...ws, schedules: ws.schedules.map(job => job.id === id ? { ...job, ...policy } : job) };
}

export function reviewMissedSchedule(ws: Workspace, id: string, runLatest: boolean, now = stamp()): Workspace {
  if (ws.halted) return ws;
  return { ...ws, schedules: ws.schedules.map(job => {
    if (job.id !== id || !job.recoveryPending) return job;
    const latest = scheduleOccurrences({ ...job, missedPolicy: runLatest ? "latest" : "skip" }, now);
    const nextRunAt = runLatest ? latest.occurrences[0] ?? latest.nextRunAt : latest.nextRunAt;
    return { ...job, enabled: true, recoveryPending: false, lastError: "", nextRunAt, recoveryApprovalFor: runLatest ? nextRunAt : undefined };
  }) };
}

export function runDueSchedules(ws: Workspace, now: string, environment: NonNullable<ScheduleJob["executionTarget"]> = "browser"): Workspace {
  if (ws.halted || !ws.schedules.some((job) => job.enabled && job.nextRunAt <= now)) return ws;
  let next = ws;
  const jobs = ws.schedules.map(job => {
    if (!job.enabled || job.nextRunAt > now || (job.executionTarget ?? "browser") !== environment) return job;
    if (job.chatId && !next.chats.some(chat => chat.id === job.chatId && !chat.temporary && !chat.archived)) {
      return { ...job, enabled: false, lastAttemptAt: now, lastError: "The scheduled conversation is unavailable." };
    }
    const agent = next.agents.find(item => item.id === job.agentId && !item.archived);
    if (!agent) return { ...job, enabled: false, lastAttemptAt: now, lastError: "That agent is not on this device. Nothing was queued." };
    const recovery = scheduleOccurrences(job.recoveryApprovalFor === job.nextRunAt ? { ...job, missedPolicy: "latest" } : job, now);
    if (recovery.needsReview) return { ...job, enabled: false, recoveryPending: true, missedOccurrences: recovery.missed, lastAttemptAt: now, lastError: "This schedule missed its time. Review the missed occurrence before resuming." };
    const occurrences = [...(job.occurrences ?? [])];
    const activeIds = new Set([job.lastQueuedRunId, ...occurrences.map((entry) => entry.runId)]);
    const active = next.runs.filter((run) => activeIds.has(run.id) && !TERMINAL.has(run.state));
    const skipOverlap = active.length > 0 && job.overlapPolicy === "skip";
    if (active.length && !skipOverlap && (job.overlapPolicy !== "parallel" || active.length >= (job.maxParallel ?? 2))) {
      return { ...job, lastError: "Waiting for the previous scheduled run.", lastAttemptAt: now };
    }
    if (skipOverlap || !recovery.occurrences.length) {
      occurrences.push({ id: job.id + ":" + job.nextRunAt, dueAt: job.nextRunAt, updatedAt: now, state: "skipped", detail: "Skipped by schedule policy.", missedCount: recovery.missed });
      return { ...job, nextRunAt: recovery.nextRunAt, lastAttemptAt: now, missedOccurrences: recovery.missed, skippedCount: (job.skippedCount ?? 0) + Math.max(1, recovery.missed + 1), occurrences: occurrences.slice(-100) };
    }
    let lastQueuedRunId = job.lastQueuedRunId;
    for (const occurrence of recovery.occurrences) {
      const occurrenceId = "scheduled:" + job.id + ":" + occurrence;
      const existing = next.runs.find(run => run.id === occurrenceId);
      const queued = existing ? { ok: true as const, ws: next, run: existing } : enqueueRun(next, agent.id, job.instruction || job.name, now, null, 0, occurrenceId);
      if (!queued.ok) return { ...job, enabled: false, nextRunAt: occurrence, lastQueuedRunId, lastAttemptAt: now, lastError: queued.error };
      next = existing ? queued.ws : { ...queued.ws, runs: queued.ws.runs.map(run => run.id === queued.run.id ? { ...run, chatId: job.chatId, scheduleId: job.id } : run) };
      lastQueuedRunId = queued.run.id;
      if (!occurrences.some((entry) => entry.runId === queued.run.id)) occurrences.push({
        id: occurrenceId, runId: queued.run.id, dueAt: occurrence, state: queued.run.state, updatedAt: queued.run.updatedAt,
        detail: "", missedCount: recovery.missed, destinationChatId: job.chatId,
      });
    }
    return { ...job, occurrences: occurrences.slice(-100), recoveryPending: false, recoveryApprovalFor: undefined, missedOccurrences: recovery.missed, lastAttemptAt: now, lastQueuedRunId, lastError: "", nextRunAt: recovery.nextRunAt };
  });
  return { ...next, schedules: jobs };
}

export type FleetModelRequest = {
  operationId: string;
  runId: string;
  agentId: string;
  agentVersion: number;
  provider: string;
  tier: ModelTier | null;
  goal: string;
  instructions: string;
  knowledge: string;
  notes: { id: string; text: string }[];
  maxCalls: 1;
};

/** A server must persist this claim before making the single permitted provider call. */
export function claimFleetModelStep(ws: Workspace, runId: string, operationId: string, now: string): { ok: true; ws: Workspace; request: FleetModelRequest } | { ok: false; error: string } {
  const run = ws.runs.find((item) => item.id === runId);
  const agent = run && ws.agents.find((item) => item.id === run.agentId && !item.archived);
  if (ws.halted || !run || !agent) return { ok: false, error: "The run is unavailable or stopped." };
  if (run.step >= run.maxSteps || !["queued", "waiting_external"].includes(run.state) || run.plan[run.step]?.tool !== "model" || !agent.tools.includes("model")) return { ok: false, error: "This run has no permitted model step." };
  if (run.configuration && JSON.stringify(run.configuration) !== JSON.stringify(configurationOf(agent))) return { ok: false, error: "The reviewed agent configuration changed before execution." };
  if (run.modelOperation) return { ok: false, error: "This model operation already started. Reconcile its outcome before creating new work." };
  if (!run.execution?.provider || !run.agentVersion || run.agentVersion !== agent.version) return { ok: false, error: "Review the agent provider and revision before starting its model step." };
  const request: FleetModelRequest = { operationId, runId, agentId: run.agentId, agentVersion: run.agentVersion, provider: run.execution.provider, tier: run.execution.tier, goal: run.goal, instructions: run.execution.instructions, knowledge: run.execution.knowledge, notes: agent.memory === "on" && run.execution.memory === "on" ? ws.memories.filter((note) => !note.archived && (note.scope === "global" || note.scope === "project" && !!run.execution?.projectId && note.projectId === run.execution.projectId)).slice(0, 12).map(({ id, text }) => ({ id, text })) : [], maxCalls: 1 };
  return { ok: true, request, ws: { ...ws, runs: ws.runs.map((item) => item.id === runId ? { ...item, state: "waiting_external" as const, modelOperation: { id: operationId, state: "claimed" as const, provider: request.provider }, updatedAt: now, error: "Model operation accepted; awaiting its verified result." } : item) } };
}

export function completeFleetModelStep(ws: Workspace, request: FleetModelRequest, outcome: { ok: boolean; text?: string; error?: string; provider: string; model?: string; dispatched?: boolean }, now: string): Workspace {
  return { ...ws, runs: ws.runs.map((run) => {
    if (run.id !== request.runId || run.modelOperation?.id !== request.operationId || run.modelOperation.state !== "claimed") return run;
    if (ws.halted || run.state === "canceled") {
      if (outcome.ok && outcome.provider === request.provider && outcome.text?.trim()) {
        const updated = recordStep(run, run.plan[run.step]!, now, outcome.text, [], false, { provider: outcome.provider, model: outcome.model, operationId: request.operationId });
        return { ...updated, state: "canceled" as const, modelOperation: { ...run.modelOperation, state: "completed" as const, model: outcome.model },
          error: "Stopped. The provider had already returned this result. No further steps ran." };
      }
      return { ...run, modelOperation: outcome.dispatched === false ? undefined : { ...run.modelOperation, state: "uncertain" as const },
        error: outcome.dispatched === false ? "Stopped before dispatch." : "Stopped while a provider outcome was pending; no new work started." };
    }
    if (!outcome.ok || outcome.provider !== request.provider || !outcome.text?.trim()) return { ...run, modelOperation: outcome.dispatched === false ? undefined : { ...run.modelOperation, state: "uncertain" as const }, state: "waiting_external" as const, error: outcome.error || "The requested provider result could not be verified. It was not retried." };
    const updated = recordStep(run, run.plan[run.step]!, now, outcome.text, [], false, { provider: outcome.provider, model: outcome.model, operationId: request.operationId });
    return { ...updated, state: "queued" as const, error: "", updatedAt: now, modelOperation: { ...run.modelOperation, state: "completed" as const, model: outcome.model } };
  }) };
}
