import { decide } from "./policy.ts";
import { runLocalPlan, type LocalTool } from "./local-tools.ts";
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
  enabled: boolean;
  lastError: string;
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
    .filter((tool) => tool !== "delegate")
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
  const goals = (parts.length > 0 ? parts : [goal.trim()]).slice(0, PLAN_MAX_CHILDREN);
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
        lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
        enabled: row.enabled !== false,
        lastError: typeof row.lastError === "string" ? row.lastError.slice(0, 300) : "",
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

export function addCustomAgent(
  ws: Workspace,
  input: { name: string; instructions: string; tools: FleetTool[] },
  now?: string,
): { ok: true; ws: Workspace; agent: AgentDefinition } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the agent." };
  const tools = toolList(input.tools);
  if (tools.length === 0) return { ok: false, error: "Choose at least one tool." };
  const at = stamp(now);
  const agent: AgentDefinition = {
    id: nid("agent"),
    name,
    description: "Custom agent. It only runs the tools you selected. Unavailable tools wait instead of pretending to finish.",
    role: "custom",
    instructions: input.instructions.trim().slice(0, 2000),
    version: 1,
    tools,
    projectId: null,
    memory: "off",
    maxSteps: Math.min(8, Math.max(1, tools.length)),
    approval: tools.some((tool) => tool === "browser" || tool === "gmail_send") ? "ask" : "automatic",
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  return { ok: true, agent, ws: { ...ws, agents: [agent, ...ws.agents] } };
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

export function addSchedule(ws: Workspace, name: string, agentId: string | null, intervalMinutes: number, now?: string): { ok: true; ws: Workspace } | { ok: false; error: string } {
  const title = name.trim().slice(0, 80);
  if (!title) return { ok: false, error: "Name the schedule." };
  const at = stamp(now);
  const minutes = Math.min(10_080, Math.max(5, intervalMinutes || 1440));
  const job: ScheduleJob = {
    id: nid("job"),
    name: title,
    agentId,
    intervalMinutes: minutes,
    nextRunAt: at,
    lastRunAt: null,
    enabled: true,
    lastError: "",
  };
  return { ok: true, ws: { ...ws, schedules: [job, ...ws.schedules] } };
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

export function enqueueRun(ws: Workspace, agentId: string, goal: string, now?: string, parentId: string | null = null, depth = 0): { ok: true; ws: Workspace; run: AgentRun } | { ok: false; error: string } {
  if (ws.halted) return { ok: false, error: "Emergency stop is on. No new action can run." };
  const agent = ws.agents.find((item) => item.id === agentId && !item.archived);
  if (!agent) return { ok: false, error: "That agent is not on this device." };
  const text = goal.trim().slice(0, 2000);
  if (!text) return { ok: false, error: "Write what the agent should do." };
  if (ws.runs.length >= 200) return { ok: false, error: "Too many runs are stored on this device." };
  const at = stamp(now);
  const run: AgentRun = {
    id: nid("run"),
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
    result: "",
    error: "",
    createdAt: at,
    updatedAt: at,
  };
  const fleet = readFleet(ws);
  event(fleet, run.id, at, "task_created", `Queued ${agent.name}.`);
  return { ok: true, run, ws: withFleet(ws, { ...fleet, runs: [run, ...fleet.runs] }) };
}

export function approveRunAction(ws: Workspace, runId: string, action: string): Workspace {
  return {
    ...ws,
    runs: ws.runs.map((run) => (run.id === runId ? { ...run, approvedActions: [...run.approvedActions, action], state: run.state === "waiting_approval" ? "queued" : run.state, updatedAt: stamp() } : run)),
  };
}

export function pauseRun(ws: Workspace, runId: string): Workspace {
  return { ...ws, runs: ws.runs.map((run) => (run.id === runId && canTransition(run.state, "paused") ? { ...run, state: "paused", updatedAt: stamp() } : run)) };
}

export function resumeRun(ws: Workspace, runId: string): Workspace {
  if (ws.halted) return ws;
  return { ...ws, runs: ws.runs.map((run) => (run.id === runId && run.state === "paused" && canTransition(run.state, "queued") ? { ...run, state: "queued", updatedAt: stamp() } : run)) };
}

export function cancelRun(ws: Workspace, runId: string, now?: string): Workspace {
  const at = stamp(now);
  const fleet = readFleet(ws);
  const runs = fleet.runs.map((run) => {
    if (run.id !== runId || !canTransition(run.state, "canceled")) return run;
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
  now: string;
  workerId: string;
  browser?: (url: string) => { ok: true; title: string; excerpt: string } | { ok: false; error: string };
  search?: (query: string) => { ok: boolean; citations: { title: string; url: string }[]; error: string };
};

function finish(run: AgentRun, state: RunState, at: string, error = ""): AgentRun {
  return { ...run, state, error, updatedAt: at, leaseUntil: null, workerId: null };
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
    if (processed >= 4 || TERMINAL.has(run.state) || run.state === "paused" || run.state === "waiting_approval" || run.state === "waiting_external") return run;
    if (run.leaseUntil && run.leaseUntil > at && run.workerId && run.workerId !== env.workerId) return run;
    processed += 1;
    const agent = fleet.agents.find((item) => item.id === run.agentId);
    if (!agent) {
      event(fleet, run.id, at, "failed", "The agent definition is gone.");
      return finish(run, "failed", at, "The agent definition is gone.");
    }
    const claimed = { ...run, state: "running" as const, workerId: env.workerId, leaseUntil: new Date(Date.parse(at) + 30_000).toISOString(), updatedAt: at };
    const tool = agent.tools[claimed.step];
    if (!tool || claimed.step >= claimed.maxSteps) {
      const lines = fleet.runEvents.filter((item) => item.runId === claimed.id && item.kind === "tool_result").map((item) => item.detail);
      event(fleet, claimed.id, at, "completed", lines.length ? "Finished from tool results." : "Finished with no tool results.");
      return finish({ ...claimed, result: lines.join("\n").slice(0, 4000) || "Finished with no tool results." }, "completed", at);
    }
    if (tool === "delegate") {
      if (claimed.depth >= 1) {
        event(fleet, claimed.id, at, "tool_result", "Child runs do not delegate again.");
        return { ...claimed, step: claimed.step + 1 };
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
        for (const part of goals) {
          const child: AgentRun = {
            ...claimed,
            id: nid("run"),
            parentId: claimed.id,
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
            plan: buildTaskPlan(part, agent.tools),
          };
          extra.push(child);
          event(fleet, child.id, at, "task_created", "Delegated from the parent run.");
        }
        event(fleet, claimed.id, at, "delegated", `Delegated ${goals.length} child run${goals.length === 1 ? "" : "s"}.`);
        return { ...claimed, plan };
      }
      if (open.length) return claimed;
      const detail = kids.map((item) => item.result || item.error || item.state).join(" | ").slice(0, 500);
      event(fleet, claimed.id, at, "tool_result", detail || "Child runs finished.");
      return { ...claimed, step: claimed.step + 1 };
    }
    if (LOCAL.has(tool)) {
      const local = tool as LocalTool;
      const executed = runLocalPlan(ws, [{ id: local, tool: local, query: claimed.goal }], { autonomy: "automatic", halted: false, tokens: {} });
      const detail = executed.lines.join(" ").slice(0, 500);
      event(fleet, claimed.id, at, executed.ok ? "tool_result" : "failed", detail);
      if (!executed.ok) return finish(claimed, "failed", at, detail);
      return { ...claimed, step: claimed.step + 1 };
    }
    if (tool === "browser" || tool === "gmail_send") {
      const decision = decide({
        autonomy: agent.approval,
        kind: "publish",
        halted: false,
        approvalToken: claimed.approvedActions.includes(tool) ? `approve:${claimed.id}:${tool}` : null,
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
      const detail = result.citations.map((item) => `${item.title} ${item.url}`).join(" | ").slice(0, 500);
      event(fleet, claimed.id, at, "tool_result", detail);
      return { ...claimed, step: claimed.step + 1 };
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
      event(fleet, claimed.id, at, "tool_result", `${opened.title} ${url}`.slice(0, 500));
      return { ...claimed, step: claimed.step + 1 };
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
  return withFleet(ws, { ...fleet, runs: [...extra, ...runs] });
}

export function runDueSchedules(ws: Workspace, now: string): Workspace {
  let next = ws;
  const jobs = ws.schedules.map((job) => {
    if (!job.enabled || job.nextRunAt > now) return job;
    const agent = next.agents.find((item) => item.id === job.agentId && !item.archived);
    if (!agent) return { ...job, lastRunAt: now, lastError: "That agent is not on this device. Nothing was queued." };
    const queued = enqueueRun(next, agent.id, job.name, now);
    if (!queued.ok) return { ...job, lastRunAt: now, lastError: queued.error };
    next = queued.ws;
    return { ...job, lastRunAt: now, lastError: "", nextRunAt: new Date(Date.parse(now) + job.intervalMinutes * 60_000).toISOString() };
  });
  return { ...next, schedules: jobs };
}
