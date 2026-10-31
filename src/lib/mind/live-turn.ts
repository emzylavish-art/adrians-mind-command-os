import { pullMindEvents, type ModelUsage } from "./stream.ts";

export type LiveTurnResult =
  | { ok: true; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null }
  | { ok: false; error: string };

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
  } catch {
    return {
      ok: false,
      error: input.signal.aborted
        ? "Stopped. The unfinished reply was not saved."
        : "Grok did not answer in time. Nothing was saved as a success.",
    };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream")) {
    let message = response.status === 401 ? "Sign in is required." : "Grok could not be reached.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
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
  while (true) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      return { ok: false, error: input.signal.aborted ? "Stopped. The unfinished reply was not saved." : "Grok did not answer in time. Nothing was saved as a success." };
    }
    if (step.done) break;
    carry += decoder.decode(step.value, { stream: true });
    const pulled = pullMindEvents(carry);
    carry = pulled.rest;
    for (const event of pulled.events) {
      if (event.event === "delta") input.onDelta(event.text);
      if (event.event === "error") return { ok: false, error: event.error };
      if (event.event === "done") {
        finished = {
          ok: true,
          text: event.text,
          model: event.model,
          usage: event.usage,
          usedIds: event.usedIds,
          requestId: event.requestId,
        };
      }
    }
  }
  if (!finished || !finished.ok || !finished.text.trim()) {
    return { ok: false, error: "Grok closed the reply before it finished. Nothing was saved as a success." };
  }
  return finished;
}
