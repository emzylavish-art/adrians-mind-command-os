import { createSseFeed, pushSse, reportedModel, type ModelUsage } from "./stream.ts";
import { CHAT_DISCONNECT_REPLY, CHAT_TIMEOUT_REPLY, chatTurnTimeoutMs } from "./turn-timeouts.ts";
export { CHAT_DISCONNECT_REPLY };
import type { ChatContent } from "./media/types.ts";

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
  /** Called only when an upstream inference request is about to be dispatched. */
  onDispatch?: () => void;
  /** Optional metadata echoed on the done event (e.g. selected/resolved tier). */
  meta?: Record<string, unknown>;
  /** Called only after an xAI 401 or 400 auth failure. Must not receive the key. */
  authFallback?: () => Promise<{ ok: true; text: string; model: string; provider: string } | { ok: false; error: string }>;
}): Response {
  const linked = combineAbort(input.requestSignal, input.timeoutMs ?? chatTurnTimeoutMs());
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;

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
      try {
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        const fetchImpl = input.fetchImpl ?? fetch;
        input.onDispatch?.();
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
          const bodyText = await res.text().catch(() => "");
          const authFailed = res.status === 401 || (res.status === 400 && /incorrect api key|invalid api key|invalid_api_key|authentication/i.test(bodyText));
          if (authFailed && input.authFallback) {
            const alt = await input.authFallback();
            if (alt.ok) {
              send("done", {
                text: alt.text,
                model: alt.model,
                provider: alt.provider,
                usage: null,
                usedIds: input.usedIds,
                requestId: null,
                ...(input.meta ?? {}),
              });
            } else {
              send("error", { error: alt.error });
            }
            finish();
            return;
          }
          const error =
            res.status === 404
              ? "That model is not available. Nothing was saved as a success."
              : `Grok returned ${res.status}. Nothing was saved as a success.`;
          send("error", { error });
          finish();
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
          for (const text of pushed.deltas) send("delta", { text });
          if (pushed.done) {
            // The provider's terminal marker confirms the protocol finished;
            // keeping a socket open must not turn that answer into a timeout.
            void reader.cancel().catch(() => undefined);
            break;
          }
        }
        if (linked.signal.aborted) {
          await stopped();
          return;
        }
        const tail = pushSse(feed, "\n");
        if (tail.bad || !feed.text.trim()) {
          send("error", {
            error: tail.bad ? "Grok returned a broken stream. Nothing was saved as a success." : "Grok returned an empty reply.",
          });
          finish();
          return;
        }
        const usage: ModelUsage | null = feed.usage;
        send("done", {
          text: feed.text.trim(),
          model: reportedModel(feed.model),
          provider: "xAI",
          usage,
          usedIds: input.usedIds,
          requestId: res.headers.get("x-request-id"),
          ...(input.meta ?? {}),
        });
        finish();
      } catch (caught) {
        if (linked.signal.aborted) await stopped();
        else {
          // Network / mid-stream drop — never mislabel as a turn timeout.
          const msg = caught instanceof Error ? caught.message : "";
          void msg;
          send("error", { error: CHAT_DISCONNECT_REPLY });
          finish();
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
