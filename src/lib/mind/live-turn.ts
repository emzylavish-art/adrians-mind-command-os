import { pullMindEvents, type ModelUsage } from "./stream.ts";

import { outcomeFromDoneEvent, rememberTierOutcome } from "./model-tier-memory.ts";
import { CHAT_DISCONNECT_REPLY, CHAT_TIMEOUT_REPLY, isTimeoutAbort } from "./turn-timeouts.ts";

export const STOPPED_REPLY = "Stopped. The unfinished reply was not saved.";
export { CHAT_TIMEOUT_REPLY, CHAT_DISCONNECT_REPLY };

export type LiveTurnResult =
  | { ok: true; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; resolvedTier?: string; tierReason?: string }
  | { ok: false; error: string };

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
      return { ok: false, error: CHAT_TIMEOUT_REPLY };
    }
    return {
      ok: false,
      error: input.signal.aborted ? STOPPED_REPLY : CHAT_DISCONNECT_REPLY,
    };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream")) {
    let message =
      response.status === 401
        ? "Sign in is required."
        : response.status === 429
          ? "Too many messages. Wait a minute and try again."
          : "Grok could not be reached.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) message = payload.error;
    } catch {
      /* the status message stands */
    }
    return { ok: false, error: message };
  }
  if (!response.body) return { ok: false, error: "Grok returned an empty reply." };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let finished: LiveTurnResult | null = null;
  const stop = async (): Promise<LiveTurnResult> => {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error: STOPPED_REPLY };
  };
  while (true) {
    if (input.signal.aborted) return stop();
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await readOrAbort(reader, input.signal);
    } catch (caught) {
      await reader.cancel().catch(() => undefined);
      if (isTimeoutAbort(input.signal, caught) || isTimeoutAbort(input.signal, input.signal.reason)) {
        return { ok: false, error: CHAT_TIMEOUT_REPLY };
      }
      return {
        ok: false,
        error: input.signal.aborted ? STOPPED_REPLY : CHAT_DISCONNECT_REPLY,
      };
    }
    if (input.signal.aborted) return stop();
    if (step.done) break;
    carry += decoder.decode(step.value, { stream: true });
    const pulled = pullMindEvents(carry);
    carry = pulled.rest;
    for (const event of pulled.events) {
      if (input.signal.aborted) return stop();
      if (event.event === "delta") input.onDelta(event.text);
      if (event.event === "error" || event.event === "canceled") {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: event.error };
      }
      if (event.event === "done") {
        finished = {
          ok: true,
          text: event.text,
          model: event.model,
          usage: event.usage,
          usedIds: event.usedIds,
          requestId: event.requestId,
          modelTier: event.modelTier,
          resolvedTier: event.resolvedTier,
          tierReason: event.tierReason,
        };
        const outcome = outcomeFromDoneEvent(event);
        if (outcome) rememberTierOutcome(outcome);
      }
    }
  }
  if (input.signal.aborted || !finished || !finished.ok || !finished.text.trim()) {
    return { ok: false, error: input.signal.aborted ? STOPPED_REPLY : "Grok closed the reply before it finished. Nothing was saved as a success." };
  }
  return finished;
}