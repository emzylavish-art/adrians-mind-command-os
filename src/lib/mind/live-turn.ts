import type { RequestedReasoningEffort } from "./model-tiers.ts";
import type { SkillApplicationReceipt } from "./skill-activation.ts";
import type { ContextReceipt } from "./conversation-context.ts";
import type { ConsultEvidence, ConsultExecutionReceipt } from "./model-consult.ts";
import { readExecutionReceipts } from "./execution-receipt.ts";
import { normalizeTurnCallEvidence, pullMindEvents, type ModelUsage, type TurnCallEvidence } from "./stream.ts";

import { outcomeFromDoneEvent, rememberTierOutcome } from "./model-tier-memory.ts";
import { CHAT_DISCONNECT_REPLY, CHAT_TIMEOUT_REPLY, isTimeoutAbort } from "./turn-timeouts.ts";
import { turnErrorCode, type TurnErrorCode } from "./turn-error.ts";

export const STOPPED_REPLY = "Stopped listening for this reply. Any received partial text is kept as incomplete; provider cancellation is unconfirmed.";
export { CHAT_TIMEOUT_REPLY, CHAT_DISCONNECT_REPLY };

export type LiveTurnResult =
  | ({ ok: true; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; requestedReasoningEffort?: RequestedReasoningEffort;
  resolvedTier?: string; tierReason?: string; memorySaved?: boolean; savedMemoryId?: string | null; provider?: string; requestedModel?: string; credentialFallback?: string | null; contextReceipt?: ContextReceipt; consultation?: ConsultEvidence[]; skillReceipts?: SkillApplicationReceipt[]; delivery?: "streamed" | "buffered"; actualCostMicros?: number; currency?: "USD" } & TurnCallEvidence)
  | ({ ok: false; error: string; code?: TurnErrorCode; deliveryUncertain?: true } & TurnCallEvidence);

export function shouldStoreReply(result: LiveTurnResult): result is Extract<LiveTurnResult, { ok: true }> {
  return result.ok && result.text.trim().length > 0;
}

function readOrAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      const reason = signal.reason;
      if (reason instanceof DOMException) reject(reason);
      else reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Prepare a send on the server clock before any inference request. */
export async function prepareTurn(url: string, headers: HeadersInit, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ operationId: string; timeoutMs: number }> {
  const response = await fetchImpl(url, { method: "GET", headers, signal, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) throw new Error("Sign in to the same account before sending. No model was called.");
  if (!response.ok) throw new Error("Could not prepare this send. No model was called.");
  const value = await response.json() as { operationId?: unknown; timeoutMs?: unknown };
  if (typeof value.operationId !== "string" || !/^\d{13}-[a-f0-9-]{36}$/i.test(value.operationId)) {
    throw new Error("The server did not supply a send ID. No model was called.");
  }
  const timeoutMs = typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) ? Math.min(120_000, Math.max(1_000, value.timeoutMs)) : 30_000;
  return { operationId: value.operationId, timeoutMs };
}

export async function prepareTurnId(url: string, headers: HeadersInit, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  return (await prepareTurn(url, headers, signal, fetchImpl)).operationId;
}

export async function checkTurnReceipt(url: string, operationId: string, headers: HeadersInit, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ state: string; ownerId: string; executions?: ConsultExecutionReceipt[] }> {
  const response = await fetchImpl(`${url}?operationId=${encodeURIComponent(operationId)}`, { method: "GET", headers, signal, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) throw new Error("Sign in to the original account to check this send. No message was resent.");
  if (!response.ok) throw new Error("The earlier send could not be checked. No message was resent.");
  const result = await response.json() as { state?: unknown; ownerId?: unknown; executions?: unknown };
  if (typeof result.state !== "string" || !result.state || typeof result.ownerId !== "string" || !result.ownerId) throw new Error("The send receipt was unavailable. No message was resent.");
  const executions = readExecutionReceipts(result.executions, operationId);
  return { state: result.state, ownerId: result.ownerId, ...(executions.length ? { executions } : {}) };
}

export async function consumeMindTurn(input: {
  url: string;
  body: unknown;
  headers: HeadersInit;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  onDelta: (text: string) => void;
}): Promise<LiveTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: input.signal,
      credentials: "same-origin",
    });
  } catch (caught) {
    if (isTimeoutAbort(input.signal, caught) || (input.signal.aborted && isTimeoutAbort(input.signal, input.signal.reason))) {
      return { ok: false, error: CHAT_TIMEOUT_REPLY, code: "chat_timeout", deliveryUncertain: true };
    }
    return {
      ok: false,
      error: input.signal.aborted ? STOPPED_REPLY : CHAT_DISCONNECT_REPLY,
      code: input.signal.aborted ? "user_stopped" : "network_failure",
        ...(input.signal.aborted ? {} : { deliveryUncertain: true }),
    };
  }
  const bodyOperation = input.body && typeof input.body === "object" ? (input.body as { operationId?: unknown }).operationId : undefined;
  const operation = new Headers(input.headers).get("x-mind-turn-id") || (typeof bodyOperation === "string" ? bodyOperation : undefined);
  const primaryHeader = response.headers.get("x-mind-primary-dispatched");
  const evidence: TurnCallEvidence = {};
  if (primaryHeader === "0" || primaryHeader === "1") evidence.primaryDispatched = primaryHeader === "1";
  const addExecutions = (raw: unknown) => {
    const executions = readExecutionReceipts([...(evidence.executions ?? []), ...readExecutionReceipts(raw, operation)], operation);
    if (executions.length) evidence.executions = executions;
  };
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream")) {
    let code = turnErrorCode(undefined, response.status);
    let message =
      response.status === 401
        ? "Sign in is required."
        : response.status === 429
          ? "Too many messages. Wait a minute and try again."
          : "The model service could not be reached.";
    let uncertain = response.status >= 500 || response.status === 409 || response.ok;
    try {
      const payload = (await response.json()) as { error?: string; code?: unknown; duplicate?: boolean; executions?: unknown };
      code = turnErrorCode(payload.code, response.status);
      Object.assign(evidence, normalizeTurnCallEvidence(payload));
      addExecutions(payload.executions);
      uncertain ||= payload.duplicate === true;
      if (response.headers.get("x-mind-dispatch") === "none" && !payload.duplicate) uncertain = false;
      if (typeof payload.error === "string" && payload.error.trim()) message = payload.error;
    } catch {
      /* the status message stands */
    }
    return { ok: false, error: message, code, ...evidence, ...(uncertain && evidence.dispatched !== false ? { deliveryUncertain: true } : {}) };
  }
  if (!response.body) return { ok: false, error: "The model service returned an empty reply.", code: "invalid_response", deliveryUncertain: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  const retainEvidence = (next: TurnCallEvidence) => {
    const consultation = new Map((evidence.consultation ?? []).map((row) => [row.id, row]));
    for (const row of next.consultation ?? []) consultation.set(row.id, row);
    Object.assign(evidence, next);
    if (consultation.size) evidence.consultation = [...consultation.values()];
  };
  const stop = async (): Promise<LiveTurnResult> => {
    void reader.cancel().catch(() => undefined);
    if (isTimeoutAbort(input.signal, input.signal.reason)) return { ok: false, error: CHAT_TIMEOUT_REPLY, code: "chat_timeout", deliveryUncertain: true, ...evidence };
    return { ok: false, error: STOPPED_REPLY, code: "user_stopped", ...evidence };
  };
  while (true) {
    if (input.signal.aborted) return stop();
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await readOrAbort(reader, input.signal);
    } catch (caught) {
      void reader.cancel().catch(() => undefined);
      if (isTimeoutAbort(input.signal, caught) || isTimeoutAbort(input.signal, input.signal.reason)) {
        return { ok: false, error: CHAT_TIMEOUT_REPLY, code: "chat_timeout", deliveryUncertain: true, ...evidence };
      }
      return {
        ok: false,
        error: input.signal.aborted ? STOPPED_REPLY : CHAT_DISCONNECT_REPLY,
        code: input.signal.aborted ? "user_stopped" : "network_failure",
        ...evidence,
        ...(input.signal.aborted ? {} : { deliveryUncertain: true }),
      };
    }
    if (input.signal.aborted) return stop();
    if (step.done) break;
    carry += decoder.decode(step.value, { stream: true });
    const pulled = pullMindEvents(carry);
    carry = pulled.rest;
    for (const event of pulled.events) {
      if (input.signal.aborted) return stop();
      if (event.event === "executions") addExecutions(event.executions);
      if (event.event === "delta") input.onDelta(event.text);
      if (event.event === "consultation") retainEvidence({ consultation: event.consultation });
      if (event.event === "error" || event.event === "canceled") {
        retainEvidence(normalizeTurnCallEvidence(event));
        void reader.cancel().catch(() => undefined);
        return { ok: false, error: event.event === "canceled" ? STOPPED_REPLY : event.error, code: event.event === "canceled" ? event.code ?? "user_stopped" : turnErrorCode(event.code), ...(evidence.dispatched !== false ? { deliveryUncertain: true as const } : {}), ...evidence };
      }
      if (event.event === "done") {
        const finished: LiveTurnResult = {
          ...evidence,
          ...normalizeTurnCallEvidence(event),
          ok: true,
          contextReceipt: event.contextReceipt,
          consultation: event.consultation ?? evidence.consultation,
          skillReceipts: event.skillReceipts,
          delivery: event.delivery,
          text: event.text,
          model: event.model,
          usage: event.usage,
          usedIds: event.usedIds,
          requestId: event.requestId,
          modelTier: event.modelTier,
          requestedReasoningEffort: event.requestedReasoningEffort,
          resolvedTier: event.resolvedTier,
          tierReason: event.tierReason,
          memorySaved: event.memorySaved === true,
          savedMemoryId: event.savedMemoryId ?? null,
          provider: event.provider,
          requestedModel: event.requestedModel,
          consult: event.consult,
          credentialFallback: event.credentialFallback ?? null,
        };
        const outcome = outcomeFromDoneEvent(event);
        if (outcome) rememberTierOutcome(outcome);
        // The protocol is complete. Waiting for EOF can lose a confirmed reply on disconnect.
        void reader.cancel().catch(() => undefined);
        return finished;
      }
    }
  }
  return { ok: false, error: "The model connection closed before the reply finished. The provider may have processed this request.", code: "stream_incomplete", deliveryUncertain: true, ...evidence };
}
