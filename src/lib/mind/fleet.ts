import { decide } from "./policy.ts";
import { runLocalPlan, type LocalTool } from "./local-tools.ts";
import { nextClock, zoneIsValid } from "./schedule-clock.ts";
import { normalizeBotModel, type BotProvider } from "./bot-model.ts";
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
  | "canceled";

export type AgentDefinition = {
  id: string;
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
  agentVersion?: number;
  chatId?: string;
  scheduleId?: string;
  scheduledAt?: string;
  execution?: { provider: string | null; tier: ModelTier | null; instructions: string; knowledge: string; projectId: string | null; memory: "on" | "off" };
  delegations?: { agentId: string; goal: string; allowedTools: FleetTool[]; maxSteps: number }[];
  modelOperation?: { id: string; state: "claimed" | "uncertain" | "completed"; provider: string; model?: string };
  plan: PlanStep[];
  result: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

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
  enabled: boolean;
  lastError: string;
  timeZone: string;
  clockHour: number | null;
  clockMinute: number | null;
  leaseWorker: string | null;
  leaseUntil: string | null;
  lastStatus: "" | "ran" | "failed";
  missedPolicy?: "run-once" | "skip" | "review" | "catch-up";
  overlapPolicy?: "one-active" | "skip" | "queue";
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

export function buildTaskPlan(goal: string, tools: FleetTool[]): PlanStep[] {
  const title = goal.trim().slice(0, 160);
  return tools
    .slice(0, 8)
    .map((tool, index) => ({
      id: `step-${index + 1}`,
      title,
      tool,
      dependsOn: index === 0 ? [] : [`step-${index}`],
      need: needOf(tool),
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

export const AGENT_TEMPLATES: Omit<AgentDefinition, "id" | "createdAt" | "updatedAt" | "version" | "archived" | "projectId">[] = [
  { name: "Personal assistant", description: "Reads projects, chats, and notes on this device.", role: "assistant", instructions: "Use only the granted local reads.", tools: ["list_projects", "list_chats", "search_notes"], memory: "off", maxSteps: 6, approval: "automatic" },
  { name: "Research", description: "Searches notes, then a configured search provider. It does not invent citations.", role: "research", instructions: "Stop when search is not configured.", tools: ["search_notes", "web_search"], memory: "off", maxSteps: 4, approval: "ask" },
  { name: "Browser operator", description: "Opens one approved http(s) page when a browser driver is attached.", role: "browser", instructions: "Do not browse without approval.", tools: ["browser"], memory: "off", maxSteps: 2, approval: "ask" },
  { name: "Coding", description: "Lists projects on this device. It does not edit the repository.", role: "coding", instructions: "Do not claim a code change.", tools: ["list_projects"], memory: "off", maxSteps: 2, approval: "automatic" },
  { name: "Email", description: "Reads or sends mail only after a mailbox is connected and a send is approved.", role: "email", instructions: "Never send without approval.", tools: ["gmail_read", "gmail_send"], memory: "off", maxSteps: 3, approval: "ask" },
  { name: "Project manager", description: "Lists work, then delegates one level to the same agent without repeating delegation.", role: "manager", instructions: "Delegate once.", tools: ["list_projects", "delegate"], memory: "off", maxSteps: 4, approval: "automatic" },
  { name: "Documents", description: "Searches notes on this device.", role: "documents", instructions: "Stay inside notes.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
  { name: "Data analysis", description: "Searches notes. It does not invent charts or totals.", role: "data", instructions: "Report only note text.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
  { name: "Knowledge", description: "Lists projects and searches notes the owner already saved.", role: "knowledge", instructions: "Do not search the web.", tools: ["list_projects", "search_notes"], memory: "on", maxSteps: 4, approval: "automatic" },
  { name: "Content", description: "Searches notes for source material. It does not generate images or video.", role: "content", instructions: "Do not call a media API.", tools: ["search_notes"], memory: "off", maxSteps: 2, approval: "automatic" },
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
      const state = typeof row.state === "string" && ["queued", "running", "waiting_approval", "waiting_external", "paused", "completed", "failed", "canceled"].includes(row.state)
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
        plan: readPlan(row.plan),
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
        missedPolicy: row.missedPolicy === "skip" || row.missedPolicy === "review" || row.missedPolicy === "catch-up" ? row.missedPolicy : "run-once",
        overlapPolicy: row.overlapPolicy === "skip" || row.overlapPolicy === "queue" ? row.overlapPolicy : "one-active",
        executionTarget: row.executionTarget === "local-worker" || row.executionTarget === "hosted-worker" ? row.executionTarget : "browser",
        workerHeartbeatAt: typeof row.workerHeartbeatAt === "string" ? row.workerHeartbeatAt : undefined,
        workerId: typeof row.workerId === "string" ? row.workerId : undefined,
        missedCount: Math.max(0, Number(row.missedCount) || 0),
        skippedCount: Math.max(0, Number(row.skippedCount) || 0),
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
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : stamp(),
      });
    }
  }
  fleet.mailboxes = fleet.mailboxes.slice(0, 500);
  fleet.runEvents = fleet.runEvents.slice(0, 400);
  return fleet;
}

function readPlan(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.tool !== "string") continue;
    if (!(FLEET_TOOLS as readonly string[]).includes(row.tool)) continue;
    const dependsOn = Array.isArray(row.dependsOn) ? row.dependsOn.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
    steps.push({
      id: row.id.slice(0, 40),
      title: typeof row.title === "string" ? row.title.slice(0, 160) : "",
      tool: row.tool as FleetTool,
      dependsOn,
      need: row.need === "search" || row.need === "browser" || row.need === "gmail" || row.need === "model" ? row.need : "none",
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
};

export function addCustomAgent(
  ws: Workspace,
  input: BotDraft,
  now?: string,
): { ok: true; ws: Workspace; agent: AgentDefinition } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the agent." };
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
    enabled: true,
    lastError: clock ? "" : "",
    timeZone: clock?.zone ?? "UTC",
    clockHour: hour,
    clockMinute: hour == null ? null : minute,
    leaseWorker: null,
    leaseUntil: null,
    lastStatus: "",
    missedPolicy: "run-once",
    overlapPolicy: "one-active",
    executionTarget: "browser",
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
    return { ...job, enabled, nextRunAt, ...(runMissed ? { missedPolicy: "run-once" as const } : {}) };
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
  const text = goal.trim().slice(0, 2000);
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
    plan: buildTaskPlan(text, agent.tools),
    agentVersion: agent.version,
    execution: { provider: agent.chatProvider || null, tier: agent.chatTier || null, instructions: agent.instructions, knowledge: agent.knowledge || "", projectId: agent.projectId, memory: agent.memory },
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

export function approveRunAction(ws: Workspace, runId: string, action: string): Workspace {
  if (ws.halted) return ws;
  return { ...ws, runs: ws.runs.map((run) => {
    const agent = ws.agents.find((item) => item.id === run.agentId && !item.archived);
    if (run.id !== runId || !agent || run.state !== "waiting_approval" || run.plan[run.step]?.tool !== action) return run;
    return { ...run, approvedActions: [reviewedRunOperation(run, agent)], state: "queued" as const, updatedAt: stamp() };
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
    return { ...run, state: "canceled" as const, error: "Stopped.", updatedAt: at, leaseUntil: null };
  });
  return withFleet(ws, { ...fleet, runs });
}

export function haltFleet(ws: Workspace, now?: string): Workspace {
  const at = stamp(now);
  const fleet = readFleet(ws);
  const runs = fleet.runs.map((run) => {
    if (TERMINAL.has(run.state)) return run;
    event(fleet, run.id, at, "emergency_stop", "Emergency stop canceled this run.");
    return { ...run, state: "canceled" as const, error: "Emergency stop is on.", updatedAt: at, leaseUntil: null };
  });
  return withFleet(ws, { ...fleet, runs });
}

export type TickEnv = {
  environment?: "browser" | "local-worker" | "hosted-worker";
  now: string;
  workerId: string;
  browser?: (url: string) => { ok: true; title: string; excerpt: string } | { ok: false; error: string };
  search?: (query: string) => { ok: boolean; citations: { title: string; url: string }[]; error: string };
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
  return goal.split(/\s+/).find((part) => HTTP.test(part)) ?? "";
}

export function tickFleet(ws: Workspace, env: TickEnv): Workspace {
  const fleet = readFleet(ws);
  const at = env.now;
  if (ws.halted) return haltFleet(ws, at);
  const extra: AgentRun[] = [];
  let processed = 0;
  const runs = fleet.runs.map((run) => {
    const assignedSchedule = fleet.schedules.find((job) => job.id === run.scheduleId || run.id.startsWith(`scheduled:${job.id}:`) || run.parentId?.startsWith(`scheduled:${job.id}:`));
    if (env.environment && assignedSchedule && (assignedSchedule.executionTarget || "browser") !== env.environment) return run;
    if (processed >= 4 || TERMINAL.has(run.state) || run.state === "paused" || run.state === "waiting_approval" || run.state === "waiting_external") return run;
    if (run.leaseUntil && run.leaseUntil > at && run.workerId && run.workerId !== env.workerId) return run;
    processed += 1;
    const agent = fleet.agents.find((item) => item.id === run.agentId);
    if (!agent || agent.archived) {
      const reason = agent ? "This bot was archived before the run could finish." : "The agent definition is gone.";
      event(fleet, run.id, at, "failed", reason);
      return finish(run, "failed", at, reason);
    }
    const claimed = { ...run, state: "running" as const, workerId: env.workerId, leaseUntil: new Date(Date.parse(at) + 30_000).toISOString(), updatedAt: at };
    const tool = claimed.plan[claimed.step]?.tool;
    if (!claimed.plan.length && agent.tools.length) return finish(claimed, "failed", at, "This legacy run has no executable plan. Queue a reviewed replacement.");
    if (tool && !agent.tools.includes(tool)) return finish(claimed, "failed", at, "A planned tool is no longer allowed by the current agent. Review a new run.");
    if (!tool || claimed.step >= claimed.maxSteps) {
      const lines = fleet.runEvents.filter((item) => item.runId === claimed.id && item.kind === "tool_result").map((item) => item.detail);
      event(fleet, claimed.id, at, "completed", lines.length ? "Finished from tool results." : "Finished with no tool results.");
      return finish({ ...claimed, result: claimed.result || lines.join("\n").slice(0, 4000) || "Finished with no tool results." }, "completed", at);
    }
    if (tool === "delegate") {
      if (claimed.depth >= 1) {
        event(fleet, claimed.id, at, "tool_result", "Child runs do not delegate again.");
        return advanceWithResult(claimed, "Child runs do not delegate again.");
      }
      const kids = [...fleet.runs, ...extra].filter((item) => item.parentId === claimed.id);
      const open = kids.filter((item) => !TERMINAL.has(item.state));
      if (kids.length === 0) {
        const goals = delegationGoals(claimed.goal);
        const plan = goals.map((part, index) => ({
          id: `child-${index + 1}`,
          title: part.slice(0, 160),
          tool: "delegate" as const,
          dependsOn: [] as string[],
          need: "none" as const,
        }));
        event(fleet, claimed.id, at, "plan_generated", JSON.stringify(plan));
        for (const [index, part] of goals.entries()) {
          const assignment = claimed.delegations?.[index];
          const childAgent = assignment ? fleet.agents.find((item) => item.id === assignment.agentId && !item.archived) : agent;
          if (!childAgent) return finish(claimed, "failed", at, "The assigned child agent is unavailable. No replacement agent was selected.");
          const allowedTools = assignment ? assignment.allowedTools.filter((tool) => childAgent.tools.includes(tool) && tool !== "delegate") : childAgent.tools.filter((tool) => tool !== "delegate");
          const child: AgentRun = {
            ...claimed,
            id: nid("run"),
            parentId: claimed.id,
            agentId: childAgent.id,
            agentVersion: childAgent.version,
            execution: { provider: childAgent.chatProvider || null, tier: childAgent.chatTier || null, instructions: childAgent.instructions, knowledge: childAgent.knowledge || "", projectId: childAgent.projectId, memory: agent.memory === "on" ? childAgent.memory : "off" },
            maxSteps: Math.min(claimed.maxSteps, assignment?.maxSteps || childAgent.maxSteps),
            modelOperation: undefined,
            delegations: undefined,
            depth: 1,
            goal: part,
            state: "queued",
            step: 0,
            workerId: null,
            leaseUntil: null,
            result: "",
            error: "",
            createdAt: at,
            updatedAt: at,
            approvedActions: [],
            plan: buildTaskPlan(part, allowedTools),
          };
          extra.push(child);
          event(fleet, child.id, at, "task_created", "Delegated from the parent run.");
        }
        event(fleet, claimed.id, at, "delegated", `Delegated ${goals.length} child run${goals.length === 1 ? "" : "s"}.`);
        return claimed;
      }
      if (open.length) return claimed;
      const detail = kids.map((item) => item.result || item.error || item.state).join(" | ");
      if (kids.some((child) => child.state !== "completed")) {
        const state = kids.every((child) => child.state === "canceled") ? "canceled" : "failed";
        const outcome = kids.map((child) => child.id + ": " + child.state).join(", ");
        event(fleet, claimed.id, at, state, outcome);
        return finish({ ...claimed, result: detail }, state, at, outcome);
      }
      event(fleet, claimed.id, at, "tool_result", detail || "Child runs finished.");
      return advanceWithResult(claimed, detail);
    }
    if (LOCAL.has(tool)) {
      const local = tool as LocalTool;
      const scope = {
        ...ws,
        projects: claimed.execution?.projectId ? ws.projects.filter((project) => project.id === claimed.execution?.projectId) : agent.projectId ? ws.projects.filter((project) => project.id === agent.projectId) : ws.projects,
        chats: claimed.execution?.projectId ? ws.chats.filter((chat) => chat.projectId === claimed.execution?.projectId) : agent.projectId ? ws.chats.filter((chat) => chat.projectId === agent.projectId) : ws.chats,
        memories: agent.memory === "on" && claimed.execution?.memory !== "off" ? ws.memories.filter((note) => !note.archived && (note.scope === "global" || (note.scope === "project" && !!agent.projectId && note.projectId === agent.projectId && (!claimed.execution || note.projectId === claimed.execution.projectId)))) : [],
      };
      const executed = runLocalPlan(scope, [{ id: local, tool: local, query: claimed.goal }], { autonomy: "automatic", halted: false, tokens: {} });
      const detail = executed.lines.join(" ");
      event(fleet, claimed.id, at, executed.ok ? "tool_result" : "failed", detail);
      if (!executed.ok) return finish(claimed, "failed", at, detail);
      return advanceWithResult(claimed, detail);
    }
    if (tool === "browser" || tool === "gmail_send") {
      const decision = decide({
        autonomy: agent.approval,
        kind: "publish",
        halted: false,
        approvalToken: claimed.approvedActions.includes(reviewedRunOperation(claimed, agent)) ? `approve:${claimed.id}:${tool}` : null,
        expectedToken: `approve:${claimed.id}:${tool}`,
      });
      if (decision.decision !== "allow") {
        event(fleet, claimed.id, at, "approval_requested", `${tool} needs approval. Nothing was sent or opened.`);
        return finish({ ...claimed, state: "waiting_approval" }, "waiting_approval", at, decision.reason);
      }
    }
    if (tool === "web_search") {
      const result = env.search?.(claimed.goal) ?? { ok: false, citations: [], error: "No search provider is configured. Nothing was searched and no citations were created." };
      if (!result.ok || result.citations.length === 0) {
        event(fleet, claimed.id, at, "waiting_external", result.error);
        return finish(claimed, "waiting_external", at, result.error);
      }
      const detail = result.citations.map((item) => `${item.title} ${item.url}`).join(" | ");
      event(fleet, claimed.id, at, "tool_result", detail);
      return advanceWithResult(claimed, detail);
    }
    if (tool === "browser") {
      if (!env.browser) {
        const error = "No browser driver is attached. No page was opened.";
        event(fleet, claimed.id, at, "waiting_external", error);
        return finish(claimed, "waiting_external", at, error);
      }
      const url = quoteUrl(claimed.goal);
      if (!url) {
        const error = "The goal has no http(s) URL. No page was opened.";
        event(fleet, claimed.id, at, "failed", error);
        return finish(claimed, "failed", at, error);
      }
      // Consume the reviewed operation before invoking an attached driver.
      claimed.approvedActions = [];
      const opened = env.browser(url);
      fleet.browserSessions.unshift({
        id: nid("tab"),
        runId: claimed.id,
        url,
        title: opened.ok ? opened.title : "",
        status: opened.ok ? "open" : "failed",
        lastAction: opened.ok ? "Opened the page." : opened.error,
        excerpt: opened.ok ? opened.excerpt.slice(0, 500) : "",
        updatedAt: at,
      });
      if (!opened.ok) {
        event(fleet, claimed.id, at, "failed", opened.error);
        return finish(claimed, "failed", at, opened.error);
      }
      const detail = `${opened.title} ${url}`;
      event(fleet, claimed.id, at, "tool_result", detail);
      return advanceWithResult(claimed, detail);
    }
    if (tool === "gmail_read" || tool === "gmail_send") {
      const error = "No Gmail account is connected. Nothing was read or sent.";
      event(fleet, claimed.id, at, "waiting_external", error);
      return finish(claimed, "waiting_external", at, error);
    }
    const error = "This worker does not call a model. Nothing was sent.";
    event(fleet, claimed.id, at, "waiting_external", error);
    return finish(claimed, "waiting_external", at, error);
  });
  const schedules = fleet.schedules.map((job) => {
    if (!job.lastQueuedRunId) return job;
    const run = runs.find((item) => item.id === job.lastQueuedRunId);
    if (!run || !TERMINAL.has(run.state)) return job;
    return run.state === "completed"
      ? { ...job, lastRunAt: run.updatedAt, lastStatus: "ran" as const }
      : { ...job, lastStatus: "failed" as const, lastError: run.error || run.state };
  });
  const chats = ws.chats.map((chat) => {
    if (chat.archived || chat.temporary) return chat;
    const completed = runs.filter((run) => run.chatId === chat.id && !run.parentId && run.scheduleId && run.state === "completed" && run.result && !chat.messages.some((message) => message.id === `scheduled-result:${run.id}`));
    return completed.length ? { ...chat, messages: [...chat.messages, ...completed.map((run) => ({ id: `scheduled-result:${run.id}`, role: "assistant" as const, content: run.result, at: run.updatedAt, model: run.modelOperation?.model, provider: run.modelOperation?.provider }))] } : chat;
  });
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

export function runDueSchedules(ws: Workspace, now: string, environment?: "browser" | "local-worker" | "hosted-worker"): Workspace {
  if (ws.halted) return ws;
  let next = ws;
  const jobs = ws.schedules.map((job) => {
    if (!job.enabled || job.nextRunAt > now || (environment && (job.executionTarget || "browser") !== environment)) return job;
    if ((job.executionTarget || "browser") === "hosted-worker" && environment !== "hosted-worker") return { ...job, lastError: "No hosted autonomous worker is configured. Nothing was queued." };
    if (job.chatId && !next.chats.some((chat) => chat.id === job.chatId && !chat.temporary && !chat.archived)) {
      return { ...job, enabled: false, lastAttemptAt: now, lastError: "The scheduled conversation is unavailable. Results remain in Runs." };
    }
    const agent = next.agents.find((item) => item.id === job.agentId && !item.archived);
    if (!agent) return { ...job, enabled: false, lastAttemptAt: now, lastError: "That agent is not on this device. Nothing was queued." };
    const times: string[] = [];
    let future = job.nextRunAt;
    while (future <= now && times.length < 366) { times.push(future); future = nextOccurrence(job, future); }
    if (future <= now) future = nextOccurrence(job, now);
    const active = next.runs.filter((run) => (run.scheduleId === job.id || run.id.startsWith(`scheduled:${job.id}:`)) && !TERMINAL.has(run.state));
    const overlap = job.overlapPolicy || "one-active";
    if (active.length && overlap === "one-active") return { ...job, lastError: "An earlier occurrence is unresolved. Waiting for it before queuing another." };
    if (active.length && overlap === "skip") return { ...job, nextRunAt: future, skippedCount: (job.skippedCount || 0) + times.length, lastAttemptAt: now, lastError: "Skipped while an earlier occurrence was unresolved." };
    if (active.length >= 10) return { ...job, lastError: "The per-schedule queue limit of 10 unresolved occurrences was reached." };
    const missed = times.length > 1;
    const policy = job.missedPolicy || "run-once";
    if (missed && policy === "skip") return { ...job, nextRunAt: future, skippedCount: (job.skippedCount || 0) + times.length, lastAttemptAt: now, lastError: "Missed occurrences skipped by policy." };
    if (missed && policy === "review") return { ...job, enabled: false, missedCount: times.length, lastAttemptAt: now, lastError: `${times.length} overdue occurrences need review. Choose one recovery occurrence or resume at the next time.` };
    const selectedTimes = policy === "catch-up" && overlap === "queue" ? times.slice(0, Math.min(3, 10 - active.length)) : times.slice(0, 1);
    let lastQueuedRunId = job.lastQueuedRunId;
    for (const scheduledAt of selectedTimes) {
      const occurrenceId = `scheduled:${job.id}:${scheduledAt}`;
      const existing = next.runs.find((run) => run.id === occurrenceId);
      const queued = existing ? { ok: true as const, ws: next, run: existing } : enqueueRun(next, agent.id, job.instruction || job.name, now, null, 0, occurrenceId);
      if (!queued.ok) return { ...job, enabled: false, lastAttemptAt: now, lastError: queued.error };
      next = { ...queued.ws, runs: queued.ws.runs.map((run) => run.id === occurrenceId ? { ...run, chatId: job.chatId, scheduleId: job.id, scheduledAt } : run) };
      lastQueuedRunId = occurrenceId;
    }
    const boundedCatchUp = policy === "catch-up" && times.length > selectedTimes.length;
    return { ...job, lastAttemptAt: now, lastQueuedRunId, lastError: boundedCatchUp ? "Catch-up is bounded; remaining occurrences await another pass." : "", missedCount: missed ? times.length - 1 : 0, skippedCount: (job.skippedCount || 0) + (policy === "run-once" ? Math.max(0, times.length - 1) : 0), nextRunAt: boundedCatchUp ? times[selectedTimes.length] : future };
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
  if (run.modelOperation) return { ok: false, error: "This model operation already started. Reconcile its outcome before creating new work." };
  if (!run.execution?.provider || !run.agentVersion || run.agentVersion !== agent.version) return { ok: false, error: "Review the agent provider and revision before starting its model step." };
  const request: FleetModelRequest = { operationId, runId, agentId: run.agentId, agentVersion: run.agentVersion, provider: run.execution.provider, tier: run.execution.tier, goal: run.goal, instructions: run.execution.instructions, knowledge: run.execution.knowledge, notes: agent.memory === "on" && run.execution.memory === "on" ? ws.memories.filter((note) => !note.archived && (note.scope === "global" || note.scope === "project" && !!run.execution?.projectId && note.projectId === run.execution.projectId)).slice(0, 12).map(({ id, text }) => ({ id, text })) : [], maxCalls: 1 };
  return { ok: true, request, ws: { ...ws, runs: ws.runs.map((item) => item.id === runId ? { ...item, state: "waiting_external" as const, modelOperation: { id: operationId, state: "claimed" as const, provider: request.provider }, updatedAt: now, error: "Model operation accepted; awaiting its verified result." } : item) } };
}

export function completeFleetModelStep(ws: Workspace, request: FleetModelRequest, outcome: { ok: boolean; text?: string; error?: string; provider: string; model?: string; dispatched?: boolean }, now: string): Workspace {
  return { ...ws, runs: ws.runs.map((run) => {
    if (run.id !== request.runId || run.modelOperation?.id !== request.operationId || run.modelOperation.state !== "claimed") return run;
    if (ws.halted || run.state === "canceled") return { ...run, modelOperation: { ...run.modelOperation, state: "uncertain" as const }, error: "Stopped while a provider outcome was pending; no new work started." };
    if (!outcome.ok || outcome.provider !== request.provider || !outcome.text?.trim()) return { ...run, modelOperation: outcome.dispatched === false ? undefined : { ...run.modelOperation, state: "uncertain" as const }, state: "waiting_external" as const, error: outcome.error || "The requested provider result could not be verified. It was not retried." };
    const updated = advanceWithResult(run, outcome.text);
    return { ...updated, state: "queued" as const, error: "", updatedAt: now, modelOperation: { ...run.modelOperation, state: "completed" as const, model: outcome.model } };
  }) };
}
