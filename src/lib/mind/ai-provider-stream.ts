import { reportedModel } from "./stream.ts";
import type { AiWireProtocol, ParsedAnswer } from "./ai-provider-native.ts";

/** Read public answer deltas only; private reasoning and tool arguments are never surfaced. */
export async function consumeProviderStream(kind: AiWireProtocol, body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> }, onDelta: (text: string) => void, onReceipt?: (event: Record<string, unknown>) => void): Promise<ParsedAnswer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "", text = "", model = "model unknown", characters = 0, complete = false;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  const usageValue = (prompt: unknown, completion: unknown) => {
    if (typeof prompt === "number" && Number.isFinite(prompt) && prompt >= 0) usage = { ...(usage || {}), prompt_tokens: prompt };
    if (typeof completion === "number" && Number.isFinite(completion) && completion >= 0) usage = { ...(usage || {}), completion_tokens: completion };
  };
  const append = (value: unknown) => { if (typeof value === "string" && value) { text += value; onDelta(value); } };
  function event(frame: string) {
    const raw = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!raw) return;
    if (raw === "[DONE]") { complete = true; return; }
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) onReceipt?.(value);
    if (value.error || value.type === "error") throw new Error("The provider reported a stream error.");
    if (kind === "anthropic") {
      if (value.type === "message_start") { model = reportedModel(value.message?.model); usageValue(value.message?.usage?.input_tokens, value.message?.usage?.output_tokens); }
      if (value.type === "content_block_start" && value.content_block?.type === "tool_use") throw new Error("Tool execution is not enabled for this provider route.");
      if (value.type === "content_block_delta" && value.delta?.type === "text_delta") append(value.delta.text);
      if (value.type === "message_delta") usageValue(undefined, value.usage?.output_tokens);
      if (value.type === "message_stop") complete = true;
    } else if (kind === "gemini") {
      if (value.modelVersion) model = reportedModel(value.modelVersion);
      const first = value.candidates?.[0];
      for (const part of first?.content?.parts || []) {
        if (part.functionCall) throw new Error("Tool execution is not enabled for this provider route.");
        if (part.thought !== true) append(part.text);
      }
      usageValue(value.usageMetadata?.promptTokenCount, value.usageMetadata?.candidatesTokenCount);
      if (first?.finishReason) complete = true;
    } else {
      if (value.model) model = reportedModel(value.model);
      const first = value.choices?.[0];
      if (first?.delta?.tool_calls?.length) throw new Error("Tool execution is not enabled for this provider route.");
      append(first?.delta?.content);
      usageValue(value.usage?.prompt_tokens, value.usage?.completion_tokens);
      if (first?.finish_reason) complete = true;
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      characters += chunk.length;
      if (characters > 8_000_000) throw new Error("The provider stream exceeded the supported size.");
      pending = (pending + chunk).replace(/\r\n/g, "\n");
      let split: number;
      while ((split = pending.indexOf("\n\n")) >= 0) { event(pending.slice(0, split)); pending = pending.slice(split + 2); }
    }
    pending += decoder.decode();
    if (pending.trim()) event(pending);
    if (!complete) return { ok: false, error: "The provider stream ended before completion. The partial answer is not a completed response; no retry was dispatched." };
    if (!text.trim()) return { ok: false, error: "The provider returned no assistant text." };
    return { ok: true, text: text.trim(), model, usage };
  } catch (error) {
    return { ok: false, error: error instanceof Error && /Tool execution|supported size|stream error/.test(error.message) ? error.message : "The provider stream could not be completed. No retry or fallback was dispatched." };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
