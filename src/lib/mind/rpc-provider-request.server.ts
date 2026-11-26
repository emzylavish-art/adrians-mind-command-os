import { createHash, randomUUID } from "node:crypto";
import type { MonetaryDispatchContext, MonetarySettlement } from "./financial-policy.ts";
import type { reserveOwnerDispatch, settleOwnerDispatch } from "./dispatch-controls.server.ts";

export function rpcOperationId(value: unknown, prefix: string): string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(value) ? value : `${prefix}:${randomUUID()}`;
}

/** Bind approvals to immutable arguments, without storing audio, prompt text or keys in the ledger. */
export function rpcDispatchContext(input: Omit<MonetaryDispatchContext, "requestHash">, argumentsValue: unknown): MonetaryDispatchContext {
  return { ...input, requestHash: createHash("sha256").update(JSON.stringify(argumentsValue)).digest("hex") };
}

export type ProviderRequestDependencies = { reserve: typeof reserveOwnerDispatch; settle: typeof settleOwnerDispatch };

/** A completed API response is not a dollar receipt. Unknown cost remains conservatively reserved. */
export async function runOwnerProviderRequest<T extends { ok: boolean }>(
  ownerId: string,
  context: MonetaryDispatchContext,
  execute: () => Promise<T>,
  injected?: ProviderRequestDependencies,
): Promise<(T & { operationId: string; financialReceiptPending?: true }) | { ok: false; error: string; operationId: string; dispatched: false; approvalId?: string }> {
  const module = injected ? null : await import("./dispatch-controls.server.ts");
  const deps: ProviderRequestDependencies = injected ?? { reserve: module!.reserveOwnerDispatch, settle: module!.settleOwnerDispatch };
  const reservation = await deps.reserve(ownerId, undefined, Date.now(), context);
  if (!reservation.ok) return { ok: false, dispatched: false, error: reservation.error, operationId: context.operationId, ...(reservation.approvalId ? { approvalId: reservation.approvalId } : {}) };
  let settlement: MonetarySettlement = { outcome: "unknown" };
  try {
    const result = await execute();
    settlement = { outcome: result.ok ? "completed" : "dispatched" in result && result.dispatched === false ? "not_sent" : "unknown" };
    let financialReceiptPending = false;
    try { financialReceiptPending = !(await deps.settle(ownerId, reservation.reservationId, settlement)).ok; }
    catch { financialReceiptPending = true; }
    // A bookkeeping outage must not turn an already received result into a replayable failure.
    return { ...result, operationId: context.operationId, ...(financialReceiptPending ? { financialReceiptPending: true as const } : {}) };
  } catch (cause) {
    try { await deps.settle(ownerId, reservation.reservationId, { outcome: "unknown" }); } catch { /* The original hold remains. */ }
    throw cause;
  }
}
