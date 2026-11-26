import { MAX_HISTORY_MESSAGES } from "./context-budget.ts";
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
const windowDurations = new Map<string, number>();

/** Soft cap on distinct rate-limit keys (after TTL prune). */
export const MAX_RATE_LIMIT_KEYS = 2_000;

function pruneRateLimitWindows(now: number): void {
  for (const [key, stamps] of windows) {
    const windowMs = windowDurations.get(key) ?? 60_000;
    const recent = stamps.filter((stamp) => now - stamp < windowMs);
    if (recent.length === 0) { windows.delete(key); windowDurations.delete(key); }
    else windows.set(key, recent);
  }
  if (windows.size <= MAX_RATE_LIMIT_KEYS) return;
  const ordered = [...windows.entries()].sort((a, b) => {
    const aMax = a[1][a[1].length - 1] ?? 0;
    const bMax = b[1][b[1].length - 1] ?? 0;
    return aMax - bMax;
  });
  const excess = windows.size - MAX_RATE_LIMIT_KEYS;
  for (let i = 0; i < excess; i += 1) {
    windows.delete(ordered[i]![0]);
    windowDurations.delete(ordered[i]![0]);
  }
}

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
  pruneRateLimitWindows(now);
  const key = JSON.stringify([bucket, userId, windowMs]);
  windowDurations.set(key, windowMs);
  const result = consumeToken(windows, key, limit, windowMs, now);
  pruneRateLimitWindows(now);
  return result;
}

/** Charge one turn token and a separate bounded slot for every provider dispatch. */
export function createChatTurnPreflight(
  userId: string,
  isHalted: () => Promise<boolean>,
  consume: (bucket: string, owner: string, limit: number) => RateLimitResult | Promise<RateLimitResult & { unavailable?: boolean }> = consumeMindRateLimit,
) {
  let chatWindow: Promise<RateLimitResult & { unavailable?: boolean }> | undefined;
  return async (): Promise<Response | null> => {
    if (await isHalted()) return Response.json({ ok: false, error: "Emergency stop is on. Nothing was sent." }, { status: 403 });
    // Concurrent helpers share one chat-window decision and each consume their own dispatch allowance.
    chatWindow ??= Promise.resolve(consume("chat", userId, 12));
    const chat = await chatWindow;
    if (!chat.ok) return chat.unavailable
      ? Response.json({ ok: false, error: "Usage limits could not be checked. Nothing was sent." }, { status: 503 })
      : jsonRateLimited(CHAT_RATE_LIMIT_REPLY, chat.retryAfterSec);
    const dispatch = await consume("provider-dispatch", userId, 24);
    if (dispatch.ok) return null;
    if ("unavailable" in dispatch && dispatch.unavailable) return Response.json({ ok: false, error: "Provider limits could not be checked. Nothing was sent." }, { status: 503 });
    return jsonRateLimited("Provider call limit reached. No additional helper or answer call was sent.", dispatch.retryAfterSec);
  };
}

/** Test-only: clear the process-wide rate-limit windows. */
export function resetMindRateLimitsForTests(): void {
  windows.clear();
  windowDurations.clear();
}

/** Test-only: run TTL prune + size cap. */
export function pruneMindRateLimitsForTests(now: number, windowMs: number): void {
  void windowMs;
  pruneRateLimitWindows(now);
}

export function rateLimitMapSizeForTests(): number {
  return windows.size;
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

/** Soft cap matching media MAX_DATA_URL_CHARS * a few attachments + history images. */
/** Aligned with media history cap (MAX_DATA_URL_CHARS * 1.5 ≈ 2.7M). */
export const MAX_TURN_IMAGE_CHARS = 2_700_000;

export function checkTurnSize(input: {
  text: string;
  history: { content?: string; images?: { dataUrl?: string }[] }[];
  memoryContext: { text?: string }[];
  images?: { dataUrl?: string }[];
}): { ok: true } | { ok: false; error: string } {
  if (input.text.length > 8000) return { ok: false, error: "That message is too long." };
  // Payload safety is separate from model context allocation. A long stored reply
  // is allowed as a candidate; assembleTurn prepares a bounded extractive view.
  if (input.history.length > 10000 || input.history.reduce((sum, item) => sum + (item.content ?? "").length, 0) > 1_000_000) return { ok: false, error: "That history exceeds the request envelope. Select the relevant conversation range; the original remains saved." };
  if (input.history.some((item) => (item.content ?? "").length > 500_000)) {
    return { ok: false, error: "A previous message exceeds the safe request envelope. Attach the relevant passage; the original remains saved." };
  }
  if (input.memoryContext.length > 64) return { ok: false, error: "Too many notes were attached." };
  if (input.memoryContext.some((item) => (item.text ?? "").length > 2000)) {
    return { ok: false, error: "A note is too long to send." };
  }
  let imageChars = 0;
  for (const img of input.images ?? []) {
    if (typeof img.dataUrl === "string") imageChars += img.dataUrl.length;
  }
  for (const item of input.history) {
    for (const img of item.images ?? []) {
      if (typeof img.dataUrl === "string") imageChars += img.dataUrl.length;
    }
  }
  if (imageChars > MAX_TURN_IMAGE_CHARS) {
    return { ok: false, error: "Those images are too large to send together. Remove one or use a smaller image." };
  }
  return { ok: true };
}
