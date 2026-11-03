/**
 * BuildSession — server-side live build runtime for Adrian's Mind bots.
 * Provider-neutral: model ids come from resolveModelTier / catalog, never client injection.
 */

export const BUILD_SESSION_KIND = "build_session" as const;

export type BuildSessionStatus =
  | "planning"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export type BuildStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type BuildResolvedModel = {
  provider: string;
  model: string;
};

export type BuildPlanStep = {
  id: string;
  title: string;
  status: BuildStepStatus;
  resolved?: BuildResolvedModel;
};

export type BuildTimelineKind =
  | "reasoning"
  | "tool_call"
  | "log"
  | "diff"
  | "test_result"
  | "message"
  | "status"
  | "error"
  | "steer"
  | "summary";

export type BuildTimelineEvent = {
  id: string;
  at: string;
  kind: BuildTimelineKind;
  text: string;
  stepId?: string;
  seq: number;
};

export type BuildSession = {
  kind: typeof BUILD_SESSION_KIND;
  id: string;
  ownerId: string;
  botId: string;
  goal: string;
  status: BuildSessionStatus;
  plan: BuildPlanStep[];
  timeline: BuildTimelineEvent[];
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  summary: string;
  error: string;
  /** Pending steer messages applied before the next model step. */
  pendingSteers: string[];
  /** Last resolved model attribution for the session. */
  resolved?: BuildResolvedModel;
  /** Cursor for SSE resume (last emitted seq). */
  lastSeq: number;
};

export const BUILD_SESSION_STATUSES: readonly BuildSessionStatus[] = [
  "planning",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
] as const;

export const BUILD_TERMINAL = new Set<BuildSessionStatus>(["done", "failed", "cancelled"]);

export const MAX_BUILD_GOAL_CHARS = 2000;
export const MAX_BUILD_STEER_CHARS = 4000;
export const MAX_BUILD_TIMELINE = 500;
export const MAX_PENDING_STEERS = 20;
export const MAX_ACTIVE_SESSIONS_PER_OWNER = 3;

export const BUILD_RATE_LIMIT_REPLY = "Too many build sessions. Wait a minute and try again.";
export const BUILD_STEER_RATE_LIMIT_REPLY = "Too many steer messages. Wait a minute and try again.";

export function isBuildSessionStatus(value: unknown): value is BuildSessionStatus {
  return typeof value === "string" && (BUILD_SESSION_STATUSES as readonly string[]).includes(value);
}

export function sanitizeGoal(value: unknown): { ok: true; goal: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Write what the build should do." };
  const goal = value.trim().slice(0, MAX_BUILD_GOAL_CHARS);
  if (!goal) return { ok: false, error: "Write what the build should do." };
  return { ok: true, goal };
}

export function sanitizeSteer(value: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Steer message must be text." };
  const text = value.trim().slice(0, MAX_BUILD_STEER_CHARS);
  if (!text) return { ok: false, error: "Steer message is empty." };
  if (value.length > MAX_BUILD_STEER_CHARS) {
    return { ok: false, error: `Steer message is too long (max ${MAX_BUILD_STEER_CHARS} characters).` };
  }
  return { ok: true, text };
}

export function sanitizeBotId(value: unknown): { ok: true; botId: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "A bot id is required." };
  const botId = value.trim().slice(0, 120);
  if (!botId) return { ok: false, error: "A bot id is required." };
  if (!/^[a-zA-Z0-9_.:-]+$/.test(botId)) return { ok: false, error: "That bot id is not valid." };
  return { ok: true, botId };
}

export function sanitizeSessionId(value: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "A session id is required." };
  const id = value.trim().slice(0, 120);
  if (!id) return { ok: false, error: "A session id is required." };
  if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) return { ok: false, error: "That session id is not valid." };
  return { ok: true, id };
}

/** Reject client-injected model ids; server resolves via tier policy only. */
export function rejectInjectedModel(body: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if ("model" in body || "modelId" in body || "providerModelId" in body) {
    return { ok: false, error: "Model ids cannot be set by the client. Choose a mode/tier instead." };
  }
  return { ok: true };
}

export function defaultPlan(goal: string): BuildPlanStep[] {
  const short = goal.replace(/\s+/g, " ").slice(0, 80);
  return [
    { id: "step-plan", title: `Plan: ${short}`, status: "pending" },
    { id: "step-execute", title: "Execute with tools", status: "pending" },
    { id: "step-summarize", title: "Summarize result", status: "pending" },
  ];
}

export function createBuildSession(input: {
  id: string;
  ownerId: string;
  botId: string;
  goal: string;
  now?: string;
}): BuildSession {
  const at = input.now ?? new Date().toISOString();
  return {
    kind: BUILD_SESSION_KIND,
    id: input.id,
    ownerId: input.ownerId,
    botId: input.botId,
    goal: input.goal,
    status: "planning",
    plan: defaultPlan(input.goal),
    timeline: [
      {
        id: `evt-${input.id}-0`,
        at,
        kind: "status",
        text: "Build session created.",
        seq: 0,
      },
    ],
    startedAt: at,
    updatedAt: at,
    elapsedMs: 0,
    summary: "",
    error: "",
    pendingSteers: [],
    lastSeq: 0,
  };
}

export function appendEvent(
  session: BuildSession,
  kind: BuildTimelineKind,
  text: string,
  opts: { stepId?: string; now?: string } = {},
): BuildSession {
  const at = opts.now ?? new Date().toISOString();
  const seq = session.lastSeq + 1;
  const event: BuildTimelineEvent = {
    id: `evt-${session.id}-${seq}`,
    at,
    kind,
    text: text.slice(0, 4000),
    stepId: opts.stepId,
    seq,
  };
  const timeline = [...session.timeline, event].slice(-MAX_BUILD_TIMELINE);
  return {
    ...session,
    timeline,
    lastSeq: seq,
    updatedAt: at,
    elapsedMs: Math.max(0, Date.parse(at) - Date.parse(session.startedAt) || 0),
  };
}

export function setStatus(session: BuildSession, status: BuildSessionStatus, now?: string): BuildSession {
  const at = now ?? new Date().toISOString();
  return {
    ...session,
    status,
    updatedAt: at,
    elapsedMs: Math.max(0, Date.parse(at) - Date.parse(session.startedAt) || 0),
  };
}

export function updateStep(
  session: BuildSession,
  stepId: string,
  patch: Partial<Pick<BuildPlanStep, "status" | "title" | "resolved">>,
): BuildSession {
  return {
    ...session,
    plan: session.plan.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
  };
}

export function queueSteer(session: BuildSession, text: string): { ok: true; session: BuildSession } | { ok: false; error: string } {
  if (BUILD_TERMINAL.has(session.status)) {
    return { ok: false, error: "This build is already finished. Steer was not applied." };
  }
  if (session.pendingSteers.length >= MAX_PENDING_STEERS) {
    return { ok: false, error: "Too many pending steer messages." };
  }
  const next = appendEvent(session, "steer", text);
  return {
    ok: true,
    session: {
      ...next,
      pendingSteers: [...next.pendingSteers, text],
      status: next.status === "waiting" ? "running" : next.status,
    },
  };
}

export function takeSteers(session: BuildSession): { session: BuildSession; steers: string[] } {
  if (!session.pendingSteers.length) return { session, steers: [] };
  return { session: { ...session, pendingSteers: [] }, steers: [...session.pendingSteers] };
}

export function publicSession(session: BuildSession): Omit<BuildSession, "ownerId" | "pendingSteers"> & {
  pendingSteerCount: number;
} {
  const { ownerId: _owner, pendingSteers, ...rest } = session;
  void _owner;
  return { ...rest, pendingSteerCount: pendingSteers.length };
}

/** Map BuildSession into mind_agent_run row shape (existing persistence). */
export function toAgentRunRow(session: BuildSession): {
  id: string;
  agentId: string;
  parentId: null;
  state: string;
  body: BuildSession;
} {
  const state =
    session.status === "cancelled"
      ? "canceled"
      : session.status === "done"
        ? "completed"
        : session.status === "failed"
          ? "failed"
          : session.status === "waiting"
            ? "waiting_approval"
            : session.status === "planning"
              ? "queued"
              : "running";
  return {
    id: session.id,
    agentId: session.botId,
    parentId: null,
    state,
    body: session,
  };
}

export function fromAgentRunBody(body: unknown, ownerId: string): BuildSession | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.kind !== BUILD_SESSION_KIND) return null;
  if (typeof record.id !== "string" || typeof record.botId !== "string") return null;
  if (typeof record.goal !== "string") return null;
  if (!isBuildSessionStatus(record.status)) return null;
  return {
    kind: BUILD_SESSION_KIND,
    id: record.id,
    ownerId: typeof record.ownerId === "string" ? record.ownerId : ownerId,
    botId: record.botId,
    goal: record.goal,
    status: record.status,
    plan: Array.isArray(record.plan) ? (record.plan as BuildPlanStep[]) : [],
    timeline: Array.isArray(record.timeline) ? (record.timeline as BuildTimelineEvent[]) : [],
    startedAt: typeof record.startedAt === "string" ? record.startedAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
    elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : 0,
    summary: typeof record.summary === "string" ? record.summary : "",
    error: typeof record.error === "string" ? record.error : "",
    pendingSteers: Array.isArray(record.pendingSteers)
      ? record.pendingSteers.filter((item): item is string => typeof item === "string")
      : [],
    resolved:
      record.resolved && typeof record.resolved === "object"
        ? (record.resolved as BuildResolvedModel)
        : undefined,
    lastSeq: typeof record.lastSeq === "number" ? record.lastSeq : 0,
  };
}

/** Explicit flag for the local tickFleet simulation (not real model execution). */
export function fleetSimEnabled(env?: Record<string, string | undefined>): boolean {
  const fromProcess =
    typeof process !== "undefined" && process.env
      ? (process.env.MIND_FLEET_SIM ?? process.env.VITE_MIND_FLEET_SIM ?? "")
      : "";
  const fromVite =
    typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string | undefined> }).env
      ? ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MIND_FLEET_SIM ?? "")
      : "";
  const raw = ((env?.MIND_FLEET_SIM ?? env?.VITE_MIND_FLEET_SIM ?? fromProcess ?? fromVite) || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
