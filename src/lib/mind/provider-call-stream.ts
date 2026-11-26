import { reportedModel } from "./stream.ts";
import { readProviderReceipt, type ProviderReceipt } from "./provider-usage.ts";

/** A final metadata-only chunk must not erase usage or request identity observed earlier. */
export function mergeProviderReceipt(previous: ProviderReceipt, next: ProviderReceipt): ProviderReceipt {
  return { ...previous, ...next, requestId: next.requestId ?? previous.requestId, responseId: next.responseId ?? previous.responseId,
    usage: previous.usage || next.usage ? { ...previous.usage, ...next.usage } : null };
}

/** Native Ollama emits newline-delimited JSON; private thinking fields are not answer deltas. */
export async function consumeOllamaStream(body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> }, onDelta: (text: string) => void, headers?: Pick<Headers, "get">) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let pending = "", text = "", model = reportedModel(null), complete = false, characters = 0;
  let receipt = readProviderReceipt("ollama", null, headers);
  const row = (line: string) => {
    if (!line.trim()) return;
    const value = JSON.parse(line);
    if (!value || typeof value !== "object" || value.error) throw new Error("The local model returned a stream error.");
    if (typeof value.model === "string") model = reportedModel(value.model);
    receipt = mergeProviderReceipt(receipt, readProviderReceipt("ollama", value, headers));
    if (typeof value.response === "string" && value.response) { text += value.response; onDelta(value.response); }
    if (value.done === true) complete = true;
  };
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      const chunk = decoder.decode(next.value, { stream: true }); characters += chunk.length;
      if (characters > 8_000_000) throw new Error("The local model response exceeded its supported size.");
      pending += chunk; let at: number;
      while ((at = pending.indexOf("\n")) >= 0) { row(pending.slice(0, at)); pending = pending.slice(at + 1); }
    }
    pending += decoder.decode(); if (pending.trim()) row(pending);
    if (!complete || !text.trim()) return { ok: false, text: "", model, ...receipt, delivery: "streamed" as const, error: "The local model stream ended without a complete answer. No retry or provider fallback was started." };
    return { ok: true, text: text.trim(), model, ...receipt, delivery: "streamed" as const, error: "" };
  } catch { return { ok: false, text: "", model, ...receipt, delivery: "streamed" as const, error: "The local model stream could not be completed. Its partial answer was not saved as a completed response." }; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
