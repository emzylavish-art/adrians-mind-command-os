import { normalizeTurnCallEvidence } from "./stream.ts";
import { normalizeConsultation, type ConsultEvidence } from "./model-consult.ts";
import { providerErrorCode, turnErrorCode } from "./turn-error.ts";

/** Relay callback deltas as they arrive. Completion metadata is emitted only after a parsed success. */
export function providerResponse<T extends { ok: boolean; error?: string }>(work: (onDelta: (text: string) => void, signal: AbortSignal) => Promise<T>, done: (result: T) => Record<string, unknown>, signal: AbortSignal): Response {
  const controller = new AbortController(); let closed = false;
  const stop = () => controller.abort(signal.reason); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(stream) {
      const send = (event: string, value: unknown) => { if (!closed) stream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); };
      try { const result = await work((text) => { if (!controller.signal.aborted) send("delta", { text }); }, controller.signal); const status = (result as { httpStatus?: number }).httpStatus; if (controller.signal.aborted) send("canceled", { error: "Stopped. The unfinished reply was not saved.", code: "user_stopped", ...normalizeTurnCallEvidence(result) }); else if (result.ok) send("done", done(result)); else send("error", { error: result.error || "The selected provider did not complete this request.", code: providerErrorCode(status, (result as { code?: unknown }).code), ...normalizeTurnCallEvidence(result) }); }
      catch { send("error", { error: "The selected provider connection ended before completion. No fallback or repeat request was started.", code: "unknown" }); }
      finally { signal.removeEventListener("abort", stop); if (!closed) { closed = true; stream.close(); } }
    },
    cancel() { closed = true; controller.abort(); signal.removeEventListener("abort", stop); },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

/** Deliver completed helper receipts before starting the primary; a later failure cannot erase their usage. */
export function consultationResponse(work: () => Promise<Response>, completed: ConsultEvidence[], signal: AbortSignal): Response {
  const consultation = normalizeConsultation(completed) ?? [];
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  let stop: (() => void) | undefined;
  return new Response(new ReadableStream<Uint8Array>({
    async start(stream) {
      const send = (name: string, value: unknown) => { if (!closed) stream.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)); };
      const finish = () => { if (!closed) { closed = true; if (stop) signal.removeEventListener("abort", stop); stream.close(); } };
      stop = () => { send("canceled", { error: "Stopped. The unfinished reply was not saved.", code: "user_stopped", consultation }); void reader?.cancel().catch(() => undefined); finish(); };
      send("consultation", { consultation });
      if (signal.aborted) { stop(); return; }
      signal.addEventListener("abort", stop, { once: true });
      try {
        const response = await work();
        if (closed) { void response.body?.cancel().catch(() => undefined); return; }
        if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
          const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
          send("error", {
            error: typeof payload?.error === "string" ? payload.error : "The primary provider did not finish. Completed helper calls remain in usage.",
            ...normalizeTurnCallEvidence(payload), consultation, status: response.status,
            code: turnErrorCode(payload?.code, response.status),
            retryAfter: response.headers.get("retry-after"),
          });
          return;
        }
        if (!response.body) { send("error", { error: "The primary provider returned an empty stream.", code: "invalid_response", consultation }); return; }
        reader = response.body.getReader();
        while (!closed) {
          const next = await reader.read();
          if (next.done) break;
          if (!closed) stream.enqueue(next.value);
        }
      } catch {
        send("error", { error: "The primary connection ended before completion. Completed helper calls remain in usage.", code: "unknown", consultation });
      } finally { finish(); }
    },
    cancel() { closed = true; if (stop) signal.removeEventListener("abort", stop); void reader?.cancel().catch(() => undefined); },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}
