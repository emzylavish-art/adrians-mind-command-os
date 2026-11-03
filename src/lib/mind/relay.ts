import { createSseFeed, pushSse, type ModelUsage } from "./stream.ts";
import { CHAT_DISCONNECT_REPLY, CHAT_TIMEOUT_REPLY, chatTurnTimeoutMs } from "./turn-timeouts.ts";
export { CHAT_DISCONNECT_REPLY };
import type { ChatContent } from "./media/types.ts";
import type { FallbackOutcome } from "./failover.ts";

export const STOPPED_REPLY = "Stopped. The unfinished reply was not saved.";
const PROVIDER_URL = "https://api.x.ai/v1/chat/completions";

export type RelayMessage = { role: string; content: ChatContent };

export function combineAbort(incoming: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  abort: () => void;
  stop: () => void;
  reason: () => "cancel" | "timeout" | null;
} {
  const controller = new AbortController();
  let reason: "cancel" | "timeout" | null = null;
  const abortAs = (next: "cancel" | "timeout") => {
    if (controller.signal.aborted) return;
    reason = next;
    controller.abort(new DOMException(next === "timeout" ? "The operation timed out" : "The operation was aborted", next === "timeout" ? "TimeoutError" : "AbortError"));
  };
  const timer = setTimeout(() => abortAs("timeout"), timeoutMs);
  const onIncoming = () => abortAs("cancel");
  if (incoming.aborted) onIncoming();
  else incoming.addEventListener("abort", onIncoming, { once: true });
  return {
    signal: controller.signal,
    abort: () => abortAs("cancel"),
    reason: () => reason,
    stop: () => {
      clearTimeout(timer);
      incoming.removeEventListener("abort", onIncoming);
    },
  };
}

export type RelayModelParams = {
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh";
};

/** Exposed for unit tests that assert the outgoing provider JSON. */
export function buildRelayModelBody(model: string, messages: RelayMessage[], params: RelayModelParams = {}) {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: params.max_tokens ?? 500,
    temperature: params.temperature ?? 0.4,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort;
  return body;
}

export function relayModelStream(input: {
  apiKey: string;
  model: string;
  messages: RelayMessage[];
  usedIds: string[];
  requestSignal: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  url?: string;
  params?: RelayModelParams;
  /** Optional metadata echoed on the done event (e.g. selected/resolved tier). */
  meta?: Record<string, unknown>;
  /**
   * Failover hook. Called only when the primary failed before any reply text streamed and
   * the turn was not stopped. null/undefined = failover off: the primary error is surfaced.
   */
  onUpstreamFailure?: (error: string, signal: AbortSignal) => Promise<FallbackOutcome>;
}): Response {
  const linked = combineAbort(input.requestSignal, input.timeoutMs ?? chatTurnTimeoutMs());
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;
  let streamed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        linked.stop();
        try {
          controller.close();
        } catch {
          /* already closed by cancel */
        }
      };
      const canceled = async () => {
        try {
          await reader?.cancel();
        } catch {
          /* the provider reader is already closed */
        }
        send("canceled", { error: STOPPED_REPLY });
        finish();
      };
      const stopped = async () => {
        if (linked.reason() === "timeout") {
          try {
            await reader?.cancel();
          } catch {
            /* the provider reader is already closed */
          }
          send("error", { error: CHAT_TIMEOUT_REPLY });
          finish();
          return;
        }
        await canceled();
      };
      const onAbort = () => {
        void reader?.cancel().catch(() => undefined);
      };
      linked.signal.addEventListener("abort", onAbort);
      /** Surface the primary error, or (failover on, nothing streamed yet) retry on another provider. */
      const failOrFallback = async (error: string) => {
        if (streamed || !input.onUpstreamFailure || linked.signal.aborted) {
          if (linked.signal.aborted) await stopped();
          else {
            send("error", { error });
            finish();
          }
          return;
        }
        let outcome: FallbackOutcome;
        try {
          outcome = await input.onUpstreamFailure(error, linked.signal);
        } catch {
          outcome = { ok: false, error: `${error} Failover also failed. Nothing was saved as a success.` };
        }
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        if (!outcome.ok) {
          send("error", { error: outcome.error });
          finish();
          return;
        }
        const meta = input.meta ?? {};
        send("delta", { text: outcome.text });
        send("done", {
          text: outcome.text,
          model: outcome.model,
          provider: outcome.provider,
          failedOverFrom: outcome.failedOverFrom,
          failoverReason: outcome.failoverReason,
          usage: null,
          // Only the notes the fallback was actually sent.
          usedIds: Array.isArray(outcome.usedIds) ? outcome.usedIds : input.usedIds,
          requestId: null,
          ...(outcome.truncated === true ? { truncated: true } : {}),
          // The selected tier is echoed, but no tier "resolved": the fallback model answered.
          ...(typeof meta.modelTier === "string" ? { modelTier: meta.modelTier } : {}),
          ...(meta.memorySaved === true ? { memorySaved: true, savedMemoryId: meta.savedMemoryId ?? null } : {}),
        });
        finish();
      };
      try {
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        const fetchImpl = input.fetchImpl ?? fetch;
        const res = await fetchImpl(input.url ?? PROVIDER_URL, {
          method: "POST",
          signal: linked.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify(buildRelayModelBody(input.model, input.messages, input.params ?? {})),
        });
        if (linked.signal.aborted) {
          await res.body?.cancel().catch(() => undefined);
          await stopped();
          return;
        }
        if (!res.ok || !res.body) {
          await res.body?.cancel().catch(() => undefined);
          const error =
            res.status === 404
              ? "That model is not available. Nothing was saved as a success."
              : `Grok returned ${res.status}. Nothing was saved as a success.`;
          await failOrFallback(error);
          return;
        }
        reader = res.body.getReader();
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        const decoder = new TextDecoder();
        const feed = createSseFeed();
        while (!linked.signal.aborted) {
          const step = await reader.read();
          if (linked.signal.aborted) break;
          if (step.done) break;
          const pushed = pushSse(feed, decoder.decode(step.value, { stream: true }));
          if (pushed.bad) {
            await reader.cancel().catch(() => undefined);
            send("error", { error: "Grok returned a broken stream. Nothing was saved as a success." });
            finish();
            return;
          }
          for (const text of pushed.deltas) {
            streamed = true;
            send("delta", { text });
          }
        }
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        const tail = pushSse(feed, "\n");
        if (tail.bad || !feed.text.trim()) {
          await failOrFallback(tail.bad ? "Grok returned a broken stream. Nothing was saved as a success." : "Grok returned an empty reply.");
          return;
        }
        if (!feed.finished) {
          // Clean close at a frame boundary without [DONE]/finish_reason = cut-off reply.
          send("error", { error: "Grok's reply was cut off before it finished. Nothing was saved as a success." });
          finish();
          return;
        }
        const usage: ModelUsage | null = feed.usage;
        send("done", {
          text: feed.text.trim(),
          model: input.model,
          provider: "grok",
          usage,
          usedIds: input.usedIds,
          requestId: res.headers.get("x-request-id"),
          ...(input.meta ?? {}),
          // finish_reason "length": the reply hit max_tokens and is incomplete — say so.
          ...(feed.finishReason === "length" ? { truncated: true } : {}),
        });
        finish();
      } catch (caught) {
        if (linked.signal.aborted) await stopped();
        else {
          // Network / mid-stream drop — never mislabel as a turn timeout.
          const msg = caught instanceof Error ? caught.message : "";
          void msg;
          await failOrFallback(CHAT_DISCONNECT_REPLY);
        }
      } finally {
        linked.signal.removeEventListener("abort", onAbort);
      }
    },
    async cancel() {
      linked.abort();
      try {
        await reader?.cancel();
      } catch {
        /* already released */
      }
      closed = true;
      linked.stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
}
