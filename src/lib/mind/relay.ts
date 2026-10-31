import { createSseFeed, pushSse, type ModelUsage } from "./stream.ts";

export const STOPPED_REPLY = "Stopped. The unfinished reply was not saved.";
const PROVIDER_URL = "https://api.x.ai/v1/chat/completions";

export type RelayMessage = { role: string; content: string };

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

function modelBody(model: string, messages: RelayMessage[]) {
  return {
    model,
    messages,
    max_tokens: 500,
    temperature: 0.4,
    stream: true,
    stream_options: { include_usage: true },
  };
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
}): Response {
  const linked = combineAbort(input.requestSignal, input.timeoutMs ?? 25_000);
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
          send("error", { error: "Grok did not answer in time. Nothing was saved as a success." });
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
        const res = await fetchImpl(input.url ?? PROVIDER_URL, {
          method: "POST",
          signal: linked.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify(modelBody(input.model, input.messages)),
        });
        if (linked.signal.aborted) {
          await res.body?.cancel().catch(() => undefined);
          await stopped();
          return;
        }
        if (!res.ok || !res.body) {
          await res.body?.cancel().catch(() => undefined);
          send("error", { error: `Grok returned ${res.status}. Nothing was saved as a success.` });
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
          model: input.model,
          usage,
          usedIds: input.usedIds,
          requestId: res.headers.get("x-request-id"),
        });
        finish();
      } catch {
        if (linked.signal.aborted) await stopped();
        else {
          send("error", { error: "Grok did not answer in time. Nothing was saved as a success." });
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
