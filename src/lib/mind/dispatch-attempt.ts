import { createHash, randomUUID } from "node:crypto";
import type { MonetaryDispatchContext, MonetarySettlement } from "./financial-policy.ts";

export type DispatchIdentity = { operationId?: unknown; provider: string; model: string; stage: string; args: unknown; projectId?: unknown; taskId?: unknown; textOnly?: boolean };

/** Only a digest of immutable request arguments is stored. Never pass credentials into args. */
export function dispatchContext(input: DispatchIdentity): MonetaryDispatchContext {
  const valid = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max && !/\p{Cc}/u.test(value);
  const baseId = valid(input.operationId, 240) ? String(input.operationId).trim() : randomUUID();
  const cleanStage = input.stage.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const stage = cleanStage.length <= 40 ? cleanStage : `${cleanStage.slice(0, 12)}-${createHash("sha256").update(input.stage).digest("hex").slice(0, 24)}`;
  const operationId = `${baseId.length <= 180 ? baseId : createHash("sha256").update(baseId).digest("hex")}:${stage}`;
  return {
    operationId, provider: input.provider, model: input.model,
    taskId: valid(input.taskId, 240) ? String(input.taskId).trim() : baseId,
    projectId: valid(input.projectId, 160) ? String(input.projectId).trim() : null,
    requestHash: createHash("sha256").update(JSON.stringify(input.args) ?? "null").digest("hex"),
    textOnly: input.textOnly === true,
  };
}

export type DispatchOutcome = { ok: boolean; requestId?: string | null; actualCostMicros?: number; currency?: string; dispatched?: boolean };
export function dispatchSettlement(result: DispatchOutcome): MonetarySettlement {
  const actual = typeof result.actualCostMicros === "number" && Number.isSafeInteger(result.actualCostMicros) && result.actualCostMicros >= 0 && result.currency === "USD";
  return {
    outcome: result.dispatched === false ? "not_sent" : result.ok ? "completed" : "unknown",
    ...(actual ? { actualCostMicros: result.actualCostMicros, currency: "USD" as const } : {}),
    ...(typeof result.requestId === "string" ? { providerRequestId: result.requestId } : {}),
  };
}

/** A reporting failure cannot hide a delivered result. Its existing reservation remains held as unknown. */
export async function settleDispatchResult(ownerId: string, reservationId: string | undefined, result: DispatchOutcome, settle?: (ownerId: string, reservationId: string | undefined, settlement: MonetarySettlement) => Promise<unknown>): Promise<void> {
  if (!reservationId) return;
  try { await (settle ?? (await import("./dispatch-controls.server.ts")).settleOwnerDispatch)(ownerId, reservationId, dispatchSettlement(result)); }
  catch { /* Keep the original reservation; no missing dollar value is changed to zero. */ }
}

export type DispatchReservation = { ok: true; reservationId?: string } | { ok: false; error: string; status: number; retryAfter?: number; approvalId?: string };
export type ReserveDispatch = (ownerId: string, context: MonetaryDispatchContext) => Promise<DispatchReservation>;
export type SettleDispatch = (ownerId: string, reservationId: string | undefined, settlement: MonetarySettlement) => Promise<unknown>;
export async function reserveDispatchAttempt(ownerId: string, context: MonetaryDispatchContext, reserve?: ReserveDispatch): Promise<DispatchReservation> {
  return reserve ? reserve(ownerId, context) : (await import("./dispatch-controls.server.ts")).reserveOwnerDispatch(ownerId, undefined, undefined, context);
}
export async function runSettledDispatch<T extends DispatchOutcome>(ownerId: string, reservationId: string | undefined, work: () => Promise<T>, settle?: SettleDispatch): Promise<T> {
  try { const result = await work(); await settleDispatchResult(ownerId, reservationId, result, settle); return result; }
  catch (error) { await settleDispatchResult(ownerId, reservationId, { ok: false }, settle); throw error; }
}
export function financialProviderId(provider: string): string {
  if (provider === "grok") return "xai";
  if (provider === "nemotron") return "openrouter";
  // Custom chat choices append an encoded model after the connection UUID.
  return provider.startsWith("custom:") ? provider.split(":").slice(0, 2).join(":") : provider;
}
