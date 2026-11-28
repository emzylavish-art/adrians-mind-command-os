import type { Sql } from "../db.ts";
import { tickFleet, type AgentRun, type FleetExternalRequest } from "./fleet.ts";
import { updateOwnerWorkspace } from "./store.ts";
import type { Workspace } from "./types.ts";

export type ExternalFleetAction = "model" | "gmail_read" | "gmail_send";
export type ExternalFleetRequest = FleetExternalRequest & { action: ExternalFleetAction; accountId?: string };
export type ExternalFleetOutcome =
  | { ok: true; text: string; provider: string; model: string }
  | { ok: true; text: string; accountId: string; operationId: string }
  | { ok: false; error: string; outcome?: "not_sent" | "rejected" | "unknown"; retryable?: boolean };
export type ExternalFleetResult = { ok: boolean; error?: string; run?: AgentRun };

/**
 * Durable, owner-scoped dispatch. A crash after claim is an unknown operation,
 * never an expired lease that another worker may silently replay.
 */
export async function runExternalFleetStep(
  sql: Sql,
  ownerId: string,
  input: { runId: string; approvalId: string },
  deps: {
    stop: () => Promise<"on" | "off" | "unknown">;
    execute: (request: ExternalFleetRequest) => Promise<ExternalFleetOutcome>;
    now?: () => string;
    id?: () => string;
  },
): Promise<ExternalFleetResult> {
  if (!ownerId || !input.runId || !input.approvalId) return { ok: false, error: "Select a saved run and its exact authorization." };
  if (await deps.stop() !== "off") return { ok: false, error: "Emergency stop is on or cannot be verified. Nothing was dispatched." };
  const now = deps.now ?? (() => new Date().toISOString());
  const at = now();
  type Claim = { snapshot: Workspace; original: AgentRun; operationId: string; request: ExternalFleetRequest };
  const claim = await updateOwnerWorkspace<Claim | ExternalFleetResult>(sql, ownerId, current => {
    const run = current.runs.find(item => item.id === input.runId);
    if (!run) return { result: { ok: false, error: "This run is not saved for the signed-in owner. Wait for sync, then retry." } };
    if (current.halted || ["paused", "canceled", "failed", "completed"].includes(run.state)) return { result: { ok: false, error: "The run is stopped or finished. No external action was started.", run } };
    if (run.externalOperation && ["dispatching", "unknown"].includes(run.externalOperation.state)) return { result: { ok: false, error: "An earlier dispatch is still running or its outcome is unknown. Reconcile it before any replacement operation.", run } };
    const grant = run.pendingApproval;
    if (!grant || grant.id !== input.approvalId || grant.state !== "granted" || grant.expiresAt <= at) return { result: { ok: false, error: "The exact saved authorization is missing or expired. Review the action again.", run } };
    const tool = run.plan[run.step]?.tool;
    if (tool !== "model" && tool !== "gmail_read" && tool !== "gmail_send") return { result: { ok: false, error: "This step uses the local worker. No connected action was dispatched.", run } };
    let captured: ExternalFleetRequest | undefined;
    const isolated = { ...current, runs: [{ ...run, state: "queued" as const, workerId: null, leaseUntil: null }] };
    const checked = tickFleet(isolated, {
      now: at, workerId: "external-claim",
      model: request => { captured = { ...request, action: "model" }; return { ok: false, error: "Dispatch reserved." }; },
      gmail: request => { captured = request; return { ok: false, error: "Dispatch reserved." }; },
    });
    const validated = checked.runs[0]!;
    if (!captured) return { workspace: { ...current, runs: current.runs.map(item => item.id === run.id ? validated : item) }, result: { ok: false, error: validated.error || "This operation did not pass validation.", run: validated } };
    const operationId = (deps.id ?? (() => crypto.randomUUID()))();
    const claimed: AgentRun = { ...validated, state: "running", error: "", workerId: "external-dispatch", leaseUntil: null, externalOperation: { id: operationId, stepId: run.plan[run.step]!.id, state: "dispatching", startedAt: at } };
    return {
      workspace: { ...current, runs: current.runs.map(item => item.id === run.id ? claimed : item) },
      result: { snapshot: isolated, original: run, request: captured, operationId },
    };
  });
  if (!("request" in claim)) return claim;

  // Recheck cancellation and stop after the claim is durable, immediately before dispatch.
  const stopped = await deps.stop() !== "off";
  const ready = await updateOwnerWorkspace(sql, ownerId, current => {
    const run = current.runs.find(item => item.id === input.runId);
    const allowed = !stopped && !current.halted && run?.state === "running" && run.externalOperation?.id === claim.operationId && run.externalOperation.state === "dispatching";
    if (allowed) return { result: true };
    if (!run || run.externalOperation?.id !== claim.operationId) return { result: false };
    const canceled: AgentRun = { ...run, state: "canceled", error: "Stopped before external dispatch. Nothing was sent.", updatedAt: now(), externalOperation: { ...run.externalOperation, state: "failed", finishedAt: now() } };
    return { result: false, workspace: { ...current, runs: current.runs.map(item => item.id === run.id ? canceled : item) } };
  });
  let outcome: ExternalFleetOutcome;
  if (!ready) outcome = { ok: false, error: "Stopped before external dispatch. Nothing was sent.", outcome: "not_sent" };
  else {
    try { outcome = await deps.execute(claim.request); }
    catch { outcome = { ok: false, error: "The connected operation stopped after dispatch. Its outcome is unknown; reconcile it before retrying.", outcome: "unknown" }; }
  }
  const finishedAt = now();
  return updateOwnerWorkspace<ExternalFleetResult>(sql, ownerId, current => {
    const saved = current.runs.find(item => item.id === input.runId);
    if (!saved || saved.externalOperation?.id !== claim.operationId) return { result: { ok: false, error: "The operation result could not be attached to its run. Its dispatch must be reconciled." } };
    const replay = tickFleet(claim.snapshot, {
      now: at, workerId: "external-claim",
      model: () => outcome.ok && "provider" in outcome ? outcome : { ok: false, error: outcome.ok ? "The provider returned the wrong receipt type." : outcome.error },
      gmail: () => outcome.ok && "accountId" in outcome ? outcome : { ok: false, error: outcome.ok ? "The mailbox returned the wrong receipt type." : outcome.error },
    });
    const applied = replay.runs[0]!;
    const succeeded = outcome.ok && applied.step > claim.original.step;
    const unknown = !outcome.ok && outcome.outcome === "unknown";
    const notSent = !outcome.ok && outcome.outcome === "not_sent";
    const reviewable = notSent && !outcome.ok && outcome.retryable !== false;
    const changed = saved.goal !== claim.original.goal || JSON.stringify(saved.plan) !== JSON.stringify(claim.original.plan) || JSON.stringify(saved.configuration) !== JSON.stringify(claim.original.configuration);
    const canceled = saved.state === "canceled" || current.halted;
    const nextRun: AgentRun = {
      ...saved, step: succeeded ? applied.step : saved.step,
      result: applied.result, stepResults: applied.stepResults, approvalHistory: applied.approvalHistory,
      pendingApproval: undefined, approvedActions: [], workerId: null, leaseUntil: null, updatedAt: finishedAt,
      state: canceled ? "canceled" : changed ? "paused" : succeeded ? "queued" : reviewable ? "paused" : "failed",
      stopDispatchOutcome: canceled ? unknown ? "outcome_unknown" : succeeded || saved.stepResults?.length ? "confirmed_result" : notSent ? "not_dispatched" : saved.stopDispatchOutcome : saved.stopDispatchOutcome,
      error: canceled ? "Cancellation was requested. Review the recorded dispatch result; cancellation does not undo an external action." : changed ? "The run changed during dispatch. Its receipt is retained; review it before resuming." : succeeded ? "" : reviewable ? `${applied.error} Resume explicitly after resolving the refusal, then review a fresh tool authorization.` : applied.error,
      externalOperation: { ...saved.externalOperation, state: unknown ? "unknown" : succeeded ? "succeeded" : notSent ? "not_sent" : "failed", finishedAt },
    };
    const detail = succeeded ? "External step returned a verified provider receipt; the overall objective remains unverified." : nextRun.error;
    return {
      workspace: { ...current, runs: current.runs.map(run => run.id === nextRun.id ? nextRun : run), runEvents: [{ id: `external-${claim.operationId}`, runId: nextRun.id, at: finishedAt, kind: succeeded ? "tool_result" : unknown ? "outcome_unknown" : "failed", detail: detail.slice(0, 500) }, ...current.runEvents].slice(0, 400) },
      result: { ok: succeeded, run: nextRun, ...(succeeded ? {} : { error: nextRun.error }) },
    };
  });
}
