export type LimitState = Map<string, number[]>;

export function takeToken(state: LimitState, key: string, limit: number, windowMs: number, now: number): boolean {
  const recent = (state.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    state.set(key, recent);
    return false;
  }
  recent.push(now);
  state.set(key, recent);
  return true;
}

const windows = new Map<string, number[]>();

export function allowMindRequest(bucket: string, userId: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  return takeToken(windows, `${bucket}:${userId}`, limit, windowMs, now);
}

export function checkTurnSize(input: {
  text: string;
  history: { content?: string }[];
  memoryContext: { text?: string }[];
}): { ok: true } | { ok: false; error: string } {
  if (input.text.length > 8000) return { ok: false, error: "That message is too long." };
  if (input.history.length > 12) return { ok: false, error: "That conversation history is too long." };
  if (input.history.some((item) => (item.content ?? "").length > 8000)) {
    return { ok: false, error: "A previous message is too long." };
  }
  if (input.memoryContext.length > 12) return { ok: false, error: "Too many notes were attached." };
  if (input.memoryContext.some((item) => (item.text ?? "").length > 2000)) {
    return { ok: false, error: "A note is too long to send." };
  }
  return { ok: true };
}
