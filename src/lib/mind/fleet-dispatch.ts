import { dispatchContext, runSettledDispatch, type DispatchOutcome, type ReserveDispatch, type SettleDispatch } from "./dispatch-attempt.ts";
import type { ExternalFleetOutcome, ExternalFleetRequest } from "./fleet-external.ts";

/** Reserve one owner-scoped request before dispatch. Refusal is a known non-dispatch, not an unknown provider outcome. */
export async function withFleetDispatchLimit(
  owner: string,
  reserve: (owner: string) => Promise<{ ok: true; reservationId?: string } | { ok: false; error: string }>,
  dispatch: (reservationId?: string) => Promise<ExternalFleetOutcome>,
): Promise<ExternalFleetOutcome> {
  let permission: Awaited<ReturnType<typeof reserve>>;
  try { permission = await reserve(owner); }
  catch { return { ok: false, error: "Provider limits could not be verified. No provider was called.", outcome: "not_sent" }; }
  if (!permission.ok) return { ok: false, error: permission.error, outcome: "not_sent" };
  return dispatch(permission.reservationId);
}

export type FleetModelDispatchResult = DispatchOutcome & { text?: string; model?: string | null; error?: string };
/** Exact run/step identity survives a pre-dispatch money-review retry; no prompts enter the ledger. */
export async function withFleetModelBudget(
  owner: string,
  request: ExternalFleetRequest,
  identity: { provider: string; model: string },
  dispatch: () => Promise<FleetModelDispatchResult>,
  deps: { reserve: ReserveDispatch; settle: SettleDispatch },
): Promise<ExternalFleetOutcome> {
  const context = dispatchContext({ operationId: `fleet:${request.runId}`, stage: request.stepId, taskId: request.taskId ?? request.runId, projectId: request.projectId,
    provider: identity.provider, model: identity.model, textOnly: true,
    args: { goal: request.goal, instructions: request.instructions, input: request.input, results: request.results },
  });
  return withFleetDispatchLimit(owner, () => deps.reserve(owner,context), async reservationId => {
    const result = await runSettledDispatch(owner,reservationId,dispatch,deps.settle);
    if (result.ok && result.model && result.text?.trim()) return { ok: true, text: result.text, provider: request.provider!, model: result.model };
    const closedReservation = result.dispatched === false && Boolean(reservationId);
    return { ok: false, error: (result.error || "The provider did not return an identified model and usable answer. No verified answer was recorded.") + (closedReservation ? " The known-unsent financial reservation was closed. Queue a new run after correcting the cause; this operation ID cannot be reused." : ""), outcome: result.dispatched === false ? "not_sent" : "unknown", ...(closedReservation ? { retryable: false } : {}) };
  });
}
