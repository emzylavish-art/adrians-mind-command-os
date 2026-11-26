import type { ConsultExecutionReceipt } from "./model-consult.ts";
import { readExecutionReceipts, readPrimaryFailureReceipt, type PrimaryFailureReceipt } from "./execution-receipt.ts";

/** Honest label when a done event did not confirm which model answered. */
export const UNKNOWN_MODEL_LABEL = "model unknown";

export function reportedModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : UNKNOWN_MODEL_LABEL;
}

export type ModelUsage = { prompt_tokens?: number; completion_tokens?: number };

export function readModelPayload(raw: string): { text: string; model?: string; streamed: boolean; usage: ModelUsage | null } {
  const body = raw.trim();
  // A normal answer can itself contain the word "data:". Only protocol lines
  // identify an SSE response; content inside a JSON string does not.
  if (!/^data:/m.test(body)) {
    try {
      const parsed = JSON.parse(body) as {
        choices?: { message?: { content?: string } }[];
        model?: unknown;
        usage?: ModelUsage;
      };
      return {
        text: typeof parsed.choices?.[0]?.message?.content === "string" ? parsed.choices[0].message.content.trim() : "",
        model: reportedModel(parsed.model),
        streamed: false,
        usage: parsed.usage ?? null,
      };
    } catch {
      return { text: "", streamed: false, usage: null };
    }
  }
  const fed = pushSse(createSseFeed(), body.endsWith("\n") ? body : `${body}\n`);
  if (fed.bad) return { text: "", streamed: true, usage: null };
  return { text: fed.text.trim(), model: reportedModel(fed.model), streamed: true, usage: fed.usage };
}

export type SseFeed = { buffer: string; text: string; usage: ModelUsage | null; model?: string; bad: boolean; done?: boolean };

export function createSseFeed(): SseFeed {
  return { buffer: "", text: "", usage: null, bad: false };
}

export function pushSse(feed: SseFeed, chunk: string): SseFeed & { deltas: string[] } {
  const deltas: string[] = [];
  if (feed.bad || feed.done) return { ...feed, deltas };
  feed.buffer += chunk;
  const lines = feed.buffer.split("\n");
  feed.buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      feed.done = true;
      feed.buffer = "";
      break;
    }
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        usage?: ModelUsage | null;
        model?: unknown;
        error?: unknown;
      };
      const text = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
      if (parsed.error != null || typeof text !== "string") {
        feed.bad = true;
        return { ...feed, deltas: [] };
      }
      if (text) {
        feed.text += text;
        deltas.push(text);
      }
      if (typeof parsed.model === "string" && parsed.model.trim()) feed.model = parsed.model.trim();
      if (parsed.usage) feed.usage = parsed.usage;
    } catch {
      feed.bad = true;
      return { ...feed, deltas: [] };
    }
  }
  return { ...feed, deltas };
}

export type MindClientEvent =
  | { event: "delta"; text: string }
  | { event: "executions"; executions: ConsultExecutionReceipt[] }
  | { event: "done"; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; resolvedTier?: string; tierReason?: string; memorySaved?: boolean; savedMemoryId?: string | null; provider?: string; requestedModel?: string; credentialFallback?: string | null; executionLocation?: "local" | "hosted" }
  | ({ event: "error"; error: string } & PrimaryFailureReceipt)
  | ({ event: "canceled"; error: string } & PrimaryFailureReceipt);

export function pullMindEvents(buffer: string): { events: MindClientEvent[]; rest: string } {
  // Preserve a trailing CR until the next chunk so a split CRLF cannot create
  // an extra empty line (and prematurely finish an event).
  const trailingCr = buffer.endsWith("\r");
  buffer = (trailingCr ? buffer.slice(0, -1) : buffer).replace(/\r\n/g, "\n").replace(/\r/g, "\n") + (trailingCr ? "\r" : "");
  const complete = buffer.endsWith("\n\n");
  const parts = buffer.split("\n\n");
  const rest = complete ? "" : (parts.pop() ?? "");
  const events: MindClientEvent[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    let name = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      events.push({ event: "error", error: "The reply stream was unreadable. Nothing was saved as a success." });
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (name === "delta" && typeof record.text === "string") events.push({ event: "delta", text: record.text });
    else if (name === "executions") events.push({ event: "executions", executions: readExecutionReceipts(record.executions) });
    else if (name === "error" && typeof record.error === "string") events.push({ event: "error", error: record.error, ...readPrimaryFailureReceipt(record) });
    else if (name === "canceled" && typeof record.error === "string") events.push({ event: "canceled", error: record.error, ...readPrimaryFailureReceipt(record) });
    else if (name === "done" && typeof record.text === "string") {
      const modelRaw = typeof record.model === "string" ? record.model.trim() : "";
      events.push({
        event: "done",
        text: record.text,
        model: modelRaw || UNKNOWN_MODEL_LABEL,
        usage: record.usage && typeof record.usage === "object" ? (record.usage as ModelUsage) : null,
        usedIds: Array.isArray(record.usedIds) ? record.usedIds.filter((id) => typeof id === "string") : [],
        requestId: typeof record.requestId === "string" ? record.requestId : null,
        modelTier: typeof record.modelTier === "string" ? record.modelTier : undefined,
        resolvedTier: typeof record.resolvedTier === "string" ? record.resolvedTier : undefined,
        tierReason: typeof record.tierReason === "string" ? record.tierReason : undefined,
        memorySaved: record.memorySaved === true,
        savedMemoryId: typeof record.savedMemoryId === "string" ? record.savedMemoryId : null,
        provider: typeof record.provider === "string" ? record.provider : undefined,
        requestedModel: typeof record.requestedModel === "string" ? record.requestedModel : undefined,
        credentialFallback: typeof record.credentialFallback === "string" ? record.credentialFallback : null,
        ...(record.executionLocation === "local" || record.executionLocation === "hosted" ? { executionLocation: record.executionLocation } : {}),
      });
    }
  }
  return { events, rest };
}
