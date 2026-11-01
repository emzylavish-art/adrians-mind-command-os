export type LimitState = Map<string, number[]>;

export const CHAT_RATE_LIMIT_REPLY = "Too many messages. Wait a minute and try again.";
export const AGENT_RATE_LIMIT_REPLY = "Too many agent runs. Wait a minute and try again.";

export type RateLimitOk = { ok: true };
export type RateLimitBlocked = { ok: false; retryAfterSec: number };
export type RateLimitResult = RateLimitOk | RateLimitBlocked;

export function takeToken(state: LimitState, key: string, limit: number, windowMs: number, now: number): boolean {
  return consumeToken(state, key, limit, windowMs, now).ok;
}

/** Consume a slot or report Retry-After seconds until the oldest stamp leaves the window. */
export function consumeToken(
  state: LimitState,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  const recent = (state.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    state.set(key, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  state.set(key, recent);
  return { ok: true };
}

const windows = new Map<string, number[]>();

export function allowMindRequest(bucket: string, userId: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  return consumeMindRateLimit(bucket, userId, limit, windowMs, now).ok;
}

/**
 * Rate-limit gate for chat/agent HTTP handlers.
 * Documented choice: call this only after the body guard accepts a plain JSON object
 * (and after basic field validation for turns). Malformed bodies never reach here, so
 * they do not consume a token and still return 400 even when the user is otherwise limited.
 */
export function consumeMindRateLimit(
  bucket: string,
  userId: string,
  limit: number,
  windowMs = 60_000,
  now = Date.now(),
): RateLimitResult {
  return consumeToken(windows, `${bucket}:${userId}`, limit, windowMs, now);
}

/** Test-only: clear the process-wide rate-limit windows. */
export function resetMindRateLimitsForTests(): void {
  windows.clear();
}

export function mindRateLimitHeaders(retryAfterSec: number): Record<string, string> {
  return {
    "content-type": "application/json",
    "cache-control": "no-store",
    "retry-after": String(Math.max(1, Math.floor(retryAfterSec))),
  };
}

export function jsonRateLimited(error: string, retryAfterSec: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status: 429,
    headers: mindRateLimitHeaders(retryAfterSec),
  });
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
