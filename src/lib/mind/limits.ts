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
  if (input.history.length > 12) return { ok: false, error: "That conversation history is too long." };
  if (input.history.some((item) => (item.content ?? "").length > 8000)) {
    return { ok: false, error: "A previous message is too long." };
  }
  if (input.memoryContext.length > 12) return { ok: false, error: "Too many notes were attached." };
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
