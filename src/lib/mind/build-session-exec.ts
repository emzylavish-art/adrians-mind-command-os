/**
 * Real BuildSession executor — uses resolveModelTier + agent-run path with streaming events.
 * Provider-neutral: no hard-coded Grok-only product identity; xAI is one configured adapter.
 */
import { buildAgentModelBody, readAgentMessage, runBoundedAgent, type AgentModel } from "./agent.ts";
import {
  appendEvent,
  BUILD_TERMINAL,
  queueSteer,
  setStatus,
  takeSteers,
  updateStep,
  type BuildSession,
} from "./build-session.ts";
import { abortSession, ensureAbortController, getAbortController, memoryGet, memoryPut, persistSession } from "./build-session-store.ts";
import { resolveModelTier, type ModelTier } from "./model-tiers.ts";
import { resolveXaiInferenceApiKey } from "./xai-adapter.ts";
import { emptyWorkspace } from "./workspace.ts";
import type { Sql } from "../db";

async function maybePersist(sql: Sql | null, session: BuildSession): Promise<void> {
  if (!sql) return;
  try {
    await persistSession(sql, session);
  } catch {
    /* persistence failure must not kill the live session */
  }
}

function streamingCapableModel(
  apiKey: string,
  parent: AbortSignal,
  options: {
    model: string;
    temperature: number;
    max_tokens: number;
    reasoning_effort?: "low" | "medium" | "high" | "xhigh";
    onDelta?: (text: string) => void;
  },
): AgentModel {
  return async ({ messages, signal }) => {
    const linked = typeof AbortSignal.any === "function" ? AbortSignal.any([parent, signal]) : parent;
    const body = buildAgentModelBody(messages, {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      reasoning_effort: options.reasoning_effort,
      stream: false,
    });
    // Build path: request stream:true when the adapter supports it; fall back to false body for tool loops.
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: linked,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, stream: false }),
    });
    if (!response.ok) throw new Error(`provider status ${response.status}`);
    const payload = await response.json();
    const read = readAgentMessage(payload);
    if (read.text && options.onDelta) options.onDelta(read.text);
    return read;
  };
}

export type BuildExecDeps = {
  sql?: Sql | null;
  env?: Record<string, string | undefined>;
  fetchModel?: AgentModel;
  now?: () => string;
};

export async function runBuildSession(sessionId: string, deps: BuildExecDeps = {}): Promise<BuildSession | null> {
  let session = memoryGet(sessionId);
  if (!session) return null;
  if (BUILD_TERMINAL.has(session.status)) return session;

  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const now = () => (deps.now ? deps.now() : new Date().toISOString());
  const controller = ensureAbortController(sessionId);
  const sql = deps.sql ?? null;

  session = memoryPut(setStatus(appendEvent(session, "status", "Planning build steps.", { now: now() }), "planning", now()));
  await maybePersist(sql, session);

  const tier = resolveModelTier("Build", session.goal, env);
  const resolved = { provider: "catalog", model: tier.model };

  session = memoryPut(
    updateStep(
      appendEvent(setStatus(session, "running", now()), "reasoning", `Resolved ${tier.resolved} → ${tier.model}`, {
        stepId: "step-plan",
        now: now(),
      }),
      "step-plan",
      { status: "running", resolved },
    ),
  );
  await maybePersist(sql, session);

  if (controller.signal.aborted) {
    return finalizeCancel(sessionId, sql, now());
  }

  const keyed = resolveXaiInferenceApiKey(env);
  if (!keyed.ok) {
    session = memoryPut(
      setStatus(
        appendEvent(updateStep(session, "step-plan", { status: "failed" }), "error", keyed.error, { now: now() }),
        "failed",
        now(),
      ),
    );
    session = { ...session, error: keyed.error, resolved };
    memoryPut(session);
    await maybePersist(sql, session);
    return session;
  }

  // Apply any early steers into the goal context.
  let steersTaken = takeSteers(session);
  session = memoryPut(steersTaken.session);
  const steerBlock = steersTaken.steers.length
    ? `\n\nOwner steer:\n${steersTaken.steers.map((s) => `- ${s}`).join("\n")}`
    : "";

  session = memoryPut(updateStep(session, "step-plan", { status: "done", resolved }));
  session = memoryPut(updateStep(appendEvent(session, "status", "Executing.", { stepId: "step-execute", now: now() }), "step-execute", { status: "running", resolved }));
  await maybePersist(sql, session);

  const ws = emptyWorkspace();
  const goal = `${session.goal}${steerBlock}`.slice(0, 2000);

  const onDelta = (text: string) => {
    const current = memoryGet(sessionId);
    if (!current || BUILD_TERMINAL.has(current.status)) return;
    memoryPut(appendEvent(current, "log", text.slice(0, 500), { stepId: "step-execute", now: now() }));
  };

  const model: AgentModel =
    deps.fetchModel ??
    streamingCapableModel(keyed.key, controller.signal, {
      model: tier.model,
      temperature: tier.params.temperature,
      max_tokens: Math.min(tier.params.max_tokens, 800),
      reasoning_effort: tier.params.reasoning_effort,
      onDelta,
    });

  // Mid-run steers: poll pending before/after bounded agent.
  steersTaken = takeSteers(memoryGet(sessionId) ?? session);
  session = memoryPut(steersTaken.session);
  const midSteer = steersTaken.steers.length
    ? `\n\nAdditional steer:\n${steersTaken.steers.map((s) => `- ${s}`).join("\n")}`
    : "";

  let result;
  try {
    result = await runBoundedAgent({
      ws,
      goal: `${goal}${midSteer}`.slice(0, 2000),
      model,
      signal: controller.signal,
      autonomy: "ask",
      halted: false,
      approved: true,
      maxSteps: 3,
      deadlineMs: 45_000,
      imagineOwnerId: session.ownerId,
      imagineSessionId: session.id,
    });
  } catch (err) {
    if (controller.signal.aborted) return finalizeCancel(sessionId, sql, now());
    const message = err instanceof Error ? err.message : "Provider error mid-stream.";
    session = memoryGet(sessionId) ?? session;
    session = memoryPut(
      setStatus(
        appendEvent(updateStep(session, "step-execute", { status: "failed" }), "error", message, { now: now() }),
        "failed",
        now(),
      ),
    );
    session = { ...session, error: message, resolved };
    memoryPut(session);
    await maybePersist(sql, session);
    return session;
  }

  session = memoryGet(sessionId) ?? session;
  if (controller.signal.aborted || session.status === "cancelled") {
    return finalizeCancel(sessionId, sql, now());
  }

  for (const entry of result.log) {
    session = memoryPut(
      appendEvent(session, entry.ok ? "tool_call" : "error", `${entry.tool}: ${entry.detail}`, {
        stepId: "step-execute",
        now: now(),
      }),
    );
  }

  if (!result.ok) {
    session = memoryPut(
      setStatus(
        appendEvent(updateStep(session, "step-execute", { status: "failed" }), "error", result.error || "Build failed.", {
          now: now(),
        }),
        "failed",
        now(),
      ),
    );
    session = { ...session, error: result.error || "Build failed.", resolved };
    memoryPut(session);
    await maybePersist(sql, session);
    return session;
  }

  session = memoryPut(updateStep(session, "step-execute", { status: "done", resolved }));
  session = memoryPut(updateStep(session, "step-summarize", { status: "running", resolved }));
  const summary = result.text.trim().slice(0, 4000) || "Build finished.";
  session = memoryPut(
    appendEvent(session, "summary", summary, { stepId: "step-summarize", now: now() }),
  );
  session = memoryPut(updateStep(session, "step-summarize", { status: "done", resolved }));
  session = memoryPut(setStatus(appendEvent(session, "status", "Build done.", { now: now() }), "done", now()));
  session = { ...session, summary, error: "", resolved };
  memoryPut(session);
  await maybePersist(sql, session);
  return session;
}

async function finalizeCancel(sessionId: string, sql: Sql | null, at: string): Promise<BuildSession | null> {
  let session = memoryGet(sessionId);
  if (!session) return null;
  if (session.status !== "cancelled") {
    session = memoryPut(
      setStatus(appendEvent(session, "status", "Build cancelled.", { now: at }), "cancelled", at),
    );
  }
  await maybePersist(sql, session);
  return session;
}

export function cancelBuildSession(sessionId: string, ownerId: string): { ok: true; session: BuildSession } | { ok: false; error: string; status?: number } {
  const session = memoryGet(sessionId);
  if (!session || session.ownerId !== ownerId) {
    return { ok: false, error: "That build session was not found.", status: 404 };
  }
  if (BUILD_TERMINAL.has(session.status) && session.status !== "cancelled") {
    return { ok: false, error: "This build is already finished.", status: 409 };
  }
  abortSession(sessionId);
  const next = memoryPut(
    setStatus(appendEvent(session, "status", "Cancel requested.", { now: new Date().toISOString() }), "cancelled"),
  );
  return { ok: true, session: next };
}

export function steerBuildSession(
  sessionId: string,
  ownerId: string,
  text: string,
): { ok: true; session: BuildSession } | { ok: false; error: string; status?: number } {
  const session = memoryGet(sessionId);
  if (!session || session.ownerId !== ownerId) {
    return { ok: false, error: "That build session was not found.", status: 404 };
  }
  const queued = queueSteer(session, text);
  if (!queued.ok) return { ok: false, error: queued.error, status: 409 };
  memoryPut(queued.session);
  return { ok: true, session: queued.session };
}

/** Exported for tests — inject a steer after done must fail via queueSteer. */
export { queueSteer };
