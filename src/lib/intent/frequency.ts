/** Lightweight local frequency / recency boost for accepted intents (localStorage). */

export const INTENT_FREQ_KEY = "amcos.intent.freq.v1";

export type FrequencyStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type FreqRecord = {
  count: number;
  lastAcceptedAt: number;
};

type FreqMap = Record<string, FreqRecord>;

function readMap(store: FrequencyStore | null): FreqMap {
  if (!store) return {};
  try {
    const raw = store.getItem(INTENT_FREQ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: FreqMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as FreqRecord;
      const count = Number(row.count);
      const lastAcceptedAt = Number(row.lastAcceptedAt);
      if (!Number.isFinite(count) || count < 0) continue;
      out[id] = {
        count: Math.min(Math.floor(count), 10_000),
        lastAcceptedAt: Number.isFinite(lastAcceptedAt) ? lastAcceptedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(store: FrequencyStore | null, map: FreqMap): void {
  if (!store) return;
  try {
    store.setItem(INTENT_FREQ_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function recordIntentAcceptance(
  intentId: string,
  store: FrequencyStore | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): void {
  if (!intentId) return;
  const map = readMap(store);
  const prev = map[intentId] ?? { count: 0, lastAcceptedAt: 0 };
  map[intentId] = { count: prev.count + 1, lastAcceptedAt: now };
  writeMap(store, map);
}

/**
 * Boost in [0, 0.25]: log frequency + mild recency (7-day half-life).
 */
export function frequencyBoost(
  intentId: string,
  store: FrequencyStore | null = typeof localStorage === "undefined" ? null : localStorage,
  now = Date.now(),
): number {
  const row = readMap(store)[intentId];
  if (!row || row.count <= 0) return 0;
  const freq = Math.min(0.18, Math.log2(1 + row.count) * 0.05);
  const ageMs = Math.max(0, now - (row.lastAcceptedAt || 0));
  const halfLife = 7 * 24 * 60 * 60 * 1000;
  const recency = 0.07 * Math.exp(-ageMs / halfLife);
  return Math.min(0.25, freq + recency);
}

export function clearIntentFrequency(
  store: FrequencyStore | null = typeof localStorage === "undefined" ? null : localStorage,
): void {
  if (!store) return;
  try {
    store.setItem(INTENT_FREQ_KEY, "{}");
  } catch {
    /* ignore */
  }
}
