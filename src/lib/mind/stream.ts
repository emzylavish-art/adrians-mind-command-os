/** Honest label when a done event did not confirm which model answered. */
export const UNKNOWN_MODEL_LABEL = "model unknown";

export type ModelUsage = { prompt_tokens?: number; completion_tokens?: number };

export function readModelPayload(raw: string): { text: string; streamed: boolean; usage: ModelUsage | null } {
  const body = raw.trim();
  if (!body.includes("data:")) {
    try {
      const parsed = JSON.parse(body) as {
        choices?: { message?: { content?: string } }[];
        usage?: ModelUsage;
      };
      return {
        text: parsed.choices?.[0]?.message?.content?.trim() ?? "",
        streamed: false,
        usage: parsed.usage ?? null,
      };
    } catch {
      return { text: "", streamed: false, usage: null };
    }
  }
  const fed = pushSse(createSseFeed(), body.endsWith("\n") ? body : `${body}\n`);
  if (fed.bad) return { text: "", streamed: true, usage: null };
  return { text: fed.text.trim(), streamed: true, usage: fed.usage };
}

export type SseFeed = { buffer: string; text: string; usage: ModelUsage | null; bad: boolean };

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
      };
      const text = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
      if (text) {
        feed.text += text;
        deltas.push(text);
      }
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
  | { event: "done"; text: string; model: string; usage: ModelUsage | null; usedIds: string[]; requestId: string | null; modelTier?: string; resolvedTier?: string; tierReason?: string; memorySaved?: boolean; savedMemoryId?: string | null }
  | { event: "error"; error: string }
  | { event: "canceled"; error: string };

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
    else if (name === "error" && typeof record.error === "string") events.push({ event: "error", error: record.error });
    else if (name === "canceled" && typeof record.error === "string") events.push({ event: "canceled", error: record.error });
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
      });
    }
  }
  return { events, rest };
}
