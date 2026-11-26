import { normalizeSkillReceipts, type SkillApplicationReceipt } from "./skill-activation.ts";
import { normalizeContextReceipt, type ContextReceipt } from "./conversation-context.ts";
import { normalizeConsultation, type ConsultEvidence } from "./model-consult.ts";
import { turnErrorCode, type TurnErrorCode } from "./turn-error.ts";
/** Honest label when a done event did not confirm which model answered. */
export const UNKNOWN_MODEL_LABEL = "model unknown";

export function reportedModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : UNKNOWN_MODEL_LABEL;
}

export type ModelUsage = { prompt_tokens?: number; completion_tokens?: number };

/** Receipts describe calls that actually returned, even when the answer did not finish. */
export type TurnCallEvidence = { consultation?: ConsultEvidence[]; usage?: ModelUsage | null; model?: string; provider?: string; requestId?: string | null; responseId?: string | null; actualCostMicros?: number; currency?: "USD"; approvalId?: string; dispatched?: false };
export function normalizeTurnCallEvidence(value: unknown): TurnCallEvidence {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const evidence: TurnCallEvidence = {};
  // Only a server's explicit whole-turn no-dispatch receipt permits exact replay.
  // Missing, truthy, or string values cannot establish that nothing was sent.
  if (row.dispatched === false) evidence.dispatched = false;
  if (typeof row.actualCostMicros === "number" && Number.isSafeInteger(row.actualCostMicros) && row.actualCostMicros >= 0 && row.actualCostMicros <= 1_000_000_000_000 && row.currency === "USD") { evidence.actualCostMicros = row.actualCostMicros; evidence.currency = "USD"; }
  if (typeof row.approvalId === "string" && /^[a-f0-9]{64}$/.test(row.approvalId)) evidence.approvalId = row.approvalId;
  const consultation = normalizeConsultation(row.consultation);
  if (consultation) evidence.consultation = consultation;
  if ("usage" in row) {
    const raw = row.usage && typeof row.usage === "object" ? row.usage as Record<string, unknown> : {};
    const usage: ModelUsage = {};
    for (const key of ["prompt_tokens", "completion_tokens"] as const) if (typeof raw[key] === "number" && Number.isSafeInteger(raw[key]) && raw[key] >= 0) usage[key] = raw[key];
    evidence.usage = Object.keys(usage).length ? usage : null;
  }
  for (const key of ["model", "provider", "requestId", "responseId"] as const) {
    const item = row[key];
    if (typeof item === "string" && item.trim() && !/\p{Cc}/u.test(item)) evidence[key] = item.slice(0, 300);
    else if ((key === "requestId" || key === "responseId") && item === null) evidence[key] = null;
  }
  return evidence;
}

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
  | { event: "consultation"; consultation: ConsultEvidence[] }
  | { event: "done"; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; resolvedTier?: string; tierReason?: string; memorySaved?: boolean; savedMemoryId?: string | null; provider?: string; requestedModel?: string; credentialFallback?: string | null; contextReceipt?: ContextReceipt; consultation?: ConsultEvidence[]; skillReceipts?: SkillApplicationReceipt[]; delivery?: "streamed" | "buffered"; actualCostMicros?: number; currency?: "USD" }
  | ({ event: "error"; error: string; code?: TurnErrorCode } & TurnCallEvidence)
  | ({ event: "canceled"; error: string; code?: TurnErrorCode } & TurnCallEvidence);

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
      events.push({ event: "error", error: "The reply stream was unreadable. Nothing was saved as a success.", code: "invalid_response" });
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (name === "delta" && typeof record.text === "string") events.push({ event: "delta", text: record.text });
    else if (name === "consultation") events.push({ event: "consultation", consultation: normalizeConsultation(record.consultation) ?? [] });
    else if (name === "error" && typeof record.error === "string") events.push({ event: "error", error: record.error, ...(record.code !== undefined || typeof record.status === "number" ? { code: turnErrorCode(record.code, typeof record.status === "number" ? record.status : undefined) } : {}), ...normalizeTurnCallEvidence(record) });
    else if (name === "canceled" && typeof record.error === "string") events.push({ event: "canceled", error: record.error, ...(record.code !== undefined ? { code: turnErrorCode(record.code) } : {}), ...normalizeTurnCallEvidence(record) });
    else if (name === "done" && typeof record.text === "string") {
      const modelRaw = typeof record.model === "string" ? record.model.trim() : "";
      events.push({
        event: "done",
        contextReceipt: normalizeContextReceipt(record.contextReceipt),
        consultation: normalizeConsultation(record.consultation),
        ...normalizeTurnCallEvidence(record),
        skillReceipts: normalizeSkillReceipts(record.skillReceipts),
        delivery: record.delivery === "streamed" || record.delivery === "buffered" ? record.delivery : undefined,
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
      });
    }
  }
  return { events, rest };
}
