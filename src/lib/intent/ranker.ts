/**
 * Pure keystroke / voice-chunk intent ranker.
 * Target: <2ms on ~100 intents (no I/O beyond optional frequency map reads).
 */
import { getIntentCatalog } from "./catalog.ts";
import { frequencyBoost, type FrequencyStore } from "./frequency.ts";
import type { CatalogIntent, RankedIntent } from "./types.ts";

export type RankOptions = {
  catalog?: CatalogIntent[];
  limit?: number;
  storage?: FrequencyStore | null;
  now?: number;
  /** Minimum score to keep (default 0.15). */
  minScore?: number;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/** Cheap bigram Dice coefficient for short fuzzy matches. */
function diceBigram(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a.includes(b) || b.includes(a) ? 0.55 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let overlap = 0;
  for (const [g, c] of A) {
    const other = B.get(g);
    if (other) overlap += Math.min(c, other);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function bestAliasScore(query: string, intent: CatalogIntent): number {
  const q = normalize(query);
  if (!q) return 0;
  const qTokens = tokens(q);
  const labels = [intent.label, ...intent.aliases].map(normalize).filter(Boolean);
  let best = 0;
  for (const label of labels) {
    if (!label) continue;
    if (label === q) {
      best = Math.max(best, 1);
      continue;
    }
    if (label.startsWith(q) || q.startsWith(label)) {
      const ratio = Math.min(label.length, q.length) / Math.max(label.length, q.length);
      best = Math.max(best, 0.72 + 0.28 * ratio);
      continue;
    }
    if (label.includes(q)) {
      best = Math.max(best, 0.55 + 0.2 * (q.length / label.length));
      continue;
    }
    const lTokens = tokens(label);
    if (qTokens.length && lTokens.length) {
      let hit = 0;
      for (const qt of qTokens) {
        if (
          lTokens.some(
            (lt) => lt === qt || lt.startsWith(qt) || qt.startsWith(lt) || diceBigram(lt, qt) >= 0.75,
          )
        ) {
          hit += 1;
        }
      }
      const tokenScore = (hit / qTokens.length) * 0.85;
      best = Math.max(best, tokenScore);
    }
    const fuzzy = diceBigram(q, label);
    if (fuzzy >= 0.55) best = Math.max(best, fuzzy * 0.9);
  }
  return best;
}

export function rankIntents(query: string, options: RankOptions = {}): RankedIntent[] {
  const catalog = options.catalog ?? getIntentCatalog();
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.15;
  const store =
    options.storage === undefined
      ? typeof localStorage === "undefined"
        ? null
        : localStorage
      : options.storage;
  const now = options.now ?? Date.now();
  const q = typeof query === "string" ? query : "";
  if (!q.trim()) return [];

  const ranked: RankedIntent[] = [];
  for (const intent of catalog) {
    const base = bestAliasScore(q, intent);
    if (base <= 0) continue;
    const boost = frequencyBoost(intent.id, store, now);
    const score = Math.min(1, base + boost);
    if (score < minScore) continue;
    ranked.push({ id: intent.id, label: intent.label, score, action: intent.action });
  }
  ranked.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return ranked.slice(0, Math.max(1, limit));
}

export function topIntent(query: string, options: RankOptions = {}): RankedIntent | null {
  return rankIntents(query, { ...options, limit: 1 })[0] ?? null;
}
