import { readHelperReceipts } from "./execution-evidence.ts";
import { readFailureEnvelope, type FailureEnvelope } from "./failure-envelope.ts";
import { readModelExecutionPlan, type ModelExecutionPlan } from "./execution-plan.ts";
import type { HelperReceipt } from "./model-consult.ts";
/** Honest label when a done event did not confirm which model answered. */
export const UNKNOWN_MODEL_LABEL = "model unknown";

export function reportedModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : UNKNOWN_MODEL_LABEL;
}

export type ModelUsage = { prompt_tokens?: number; completion_tokens?: number };

export function readModelPayload(raw: string): { text: string; model?: string; streamed: boolean; usage: ModelUsage | null } {
  const body = raw.trim();
  if (!body.includes("data:")) {
    try {
      const parsed = JSON.parse(body) as {
        choices?: { message?: { content?: string } }[];
        model?: unknown;
        usage?: ModelUsage;
      };
      return {
        text: parsed.choices?.[0]?.message?.content?.trim() ?? "",
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

export type SseFeed = { buffer: string; text: string; usage: ModelUsage | null; model?: string; bad: boolean };

export function createSseFeed(): SseFeed {
  return { buffer: "", text: "", usage: null, bad: false };
}

export function pushSse(feed: SseFeed, chunk: string): SseFeed & { deltas: string[] } {
  const deltas: string[] = [];
  if (feed.bad) return { ...feed, deltas };
  feed.buffer += chunk;
  const lines = feed.buffer.split("\n");
  feed.buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        usage?: ModelUsage | null;
        model?: unknown;
      };
      const text = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
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
  | { event: "done"; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; resolvedTier?: string; tierReason?: string; memorySaved?: boolean; savedMemoryId?: string | null; provider?: string; requestedModel?: string; credentialFallback?: string | null; helperReceipts?: HelperReceipt[]; finishReason?: string | null; resourceOperationId?: string; executionPlan?: ModelExecutionPlan }
  | { event: "error"; error: string; helperReceipts?: HelperReceipt[]; failureEnvelope?: FailureEnvelope }
  | { event: "canceled"; error: string; helperReceipts?: HelperReceipt[]; failureEnvelope?: FailureEnvelope };

export function pullMindEvents(buffer: string): { events: MindClientEvent[]; rest: string } {
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
    else if (name === "error" && typeof record.error === "string") events.push({ event: "error", error: record.error, helperReceipts: readHelperReceipts(record.helperReceipts), ...(readFailureEnvelope(record.failureEnvelope) ? { failureEnvelope: readFailureEnvelope(record.failureEnvelope)! } : {}) });
    else if (name === "canceled" && typeof record.error === "string") events.push({ event: "canceled", error: record.error, helperReceipts: readHelperReceipts(record.helperReceipts), ...(readFailureEnvelope(record.failureEnvelope) ? { failureEnvelope: readFailureEnvelope(record.failureEnvelope)! } : {}) });
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
        helperReceipts: readHelperReceipts(record.helperReceipts),
        finishReason: typeof record.finishReason === "string" ? record.finishReason : null,
        resourceOperationId: typeof record.resourceOperationId === "string" ? record.resourceOperationId : undefined,
        executionPlan: readModelExecutionPlan(record.executionPlan) ?? undefined,
      });
    }
  }
  return { events, rest };
}
