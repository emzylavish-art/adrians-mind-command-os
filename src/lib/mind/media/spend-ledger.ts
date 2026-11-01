/**
 * Per-owner Imagine spend ledger (server-oriented; memory backend for tests).
 * Estimates are approximate — update when xAI publishes stable image pricing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_IMAGINE_DAILY_CAP = 40;
export const DEFAULT_SPEND_LEDGER_PATH = ".data/media-imagine-spend.json";

/** Rough USD estimates per image (not billed truth — for owner guardrails only). */
export const IMAGINE_COST_USD: Record<string, number> = {
  "grok-imagine-image": 0.07,
  "grok-imagine-image-quality": 0.14,
};

export type ImagineSpendEvent = {
  ownerId: string;
  model: string;
  n: number;
  at: number;
  estimatedCostUsd: number;
};

export type ImagineSpendSummary = {
  ownerId: string;
  day: string; // YYYY-MM-DD UTC
  count: number;
  byModel: Record<string, number>;
  estimatedCostUsd: number;
  dailyCap: number;
  remaining: number;
};

export type ImagineSpendLedger = {
  record(input: { ownerId: string; model: string; n: number; at?: number }): ImagineSpendEvent;
  summary(ownerId: string, now?: number): ImagineSpendSummary;
  wouldExceedCap(ownerId: string, n: number, now?: number): boolean;
};

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function getImagineDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MIND_IMAGINE_DAILY_CAP;
  const n = raw ? Number(raw) : DEFAULT_IMAGINE_DAILY_CAP;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_IMAGINE_DAILY_CAP;
  return Math.min(500, Math.floor(n));
}

export function estimateImagineCostUsd(model: string, n: number): number {
  const unit = IMAGINE_COST_USD[model] ?? IMAGINE_COST_USD["grok-imagine-image"]!;
  return Math.round(unit * Math.max(1, n) * 1000) / 1000;
}

export function createMemorySpendLedger(seed: ImagineSpendEvent[] = []): ImagineSpendLedger {
  const events = [...seed];
  return {
    record(input) {
      const at = input.at ?? Date.now();
      const event: ImagineSpendEvent = {
        ownerId: input.ownerId,
        model: input.model,
        n: Math.max(1, Math.floor(input.n)),
        at,
        estimatedCostUsd: estimateImagineCostUsd(input.model, input.n),
      };
      events.push(event);
      return event;
    },
    summary(ownerId, now = Date.now()) {
      return summarize(events, ownerId, now);
    },
    wouldExceedCap(ownerId, n, now = Date.now()) {
      const s = summarize(events, ownerId, now);
      return s.count + Math.max(1, n) > s.dailyCap;
    },
  };
}

function summarize(events: ImagineSpendEvent[], ownerId: string, now: number): ImagineSpendSummary {
  const day = dayKey(now);
  const dailyCap = getImagineDailyCap();
  const byModel: Record<string, number> = {};
  let count = 0;
  let estimatedCostUsd = 0;
  for (const event of events) {
    if (event.ownerId !== ownerId) continue;
    if (dayKey(event.at) !== day) continue;
    count += event.n;
    byModel[event.model] = (byModel[event.model] ?? 0) + event.n;
    estimatedCostUsd += event.estimatedCostUsd;
  }
  estimatedCostUsd = Math.round(estimatedCostUsd * 1000) / 1000;
  return {
    ownerId,
    day,
    count,
    byModel,
    estimatedCostUsd,
    dailyCap,
    remaining: Math.max(0, dailyCap - count),
  };
}

export function createFileSpendLedger(filePath: string): ImagineSpendLedger {
  function readAll(): ImagineSpendEvent[] {
    try {
      if (!existsSync(filePath)) return [];
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { events?: ImagineSpendEvent[] };
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }
  function writeAll(events: ImagineSpendEvent[]) {
    mkdirSync(dirname(filePath), { recursive: true });
    // Keep ~14 days
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const trimmed = events.filter((event) => event.at >= cutoff);
    writeFileSync(filePath, JSON.stringify({ events: trimmed }, null, 0), "utf8");
  }
  return {
    record(input) {
      const events = readAll();
      const at = input.at ?? Date.now();
      const event: ImagineSpendEvent = {
        ownerId: input.ownerId,
        model: input.model,
        n: Math.max(1, Math.floor(input.n)),
        at,
        estimatedCostUsd: estimateImagineCostUsd(input.model, input.n),
      };
      events.push(event);
      writeAll(events);
      return event;
    },
    summary(ownerId, now = Date.now()) {
      return summarize(readAll(), ownerId, now);
    },
    wouldExceedCap(ownerId, n, now = Date.now()) {
      const s = summarize(readAll(), ownerId, now);
      return s.count + Math.max(1, n) > s.dailyCap;
    },
  };
}

let activeLedger: ImagineSpendLedger = createMemorySpendLedger();

export function setImagineSpendLedger(ledger: ImagineSpendLedger) {
  activeLedger = ledger;
}

export function getImagineSpendLedger(): ImagineSpendLedger {
  return activeLedger;
}

export function resetImagineSpendLedgerForTests() {
  activeLedger = createMemorySpendLedger();
}

/** Apply rate-limit + daily cap. Call before any xAI image spend. */
export function assertImagineSpendAllowed(input: {
  ownerId: string;
  sessionId?: string;
  n: number;
  checkRateLimit: (key: string) => { ok: true } | { ok: false; error: string; retryAfterSec: number };
  rateLimitKey: (parts: { ownerId: string; sessionId?: string }) => string;
}): { ok: true } | { ok: false; error: string; status: number } {
  const ownerId = input.ownerId.trim();
  if (!ownerId) return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
  const rate = input.checkRateLimit(input.rateLimitKey({ ownerId, sessionId: input.sessionId }));
  if (!rate.ok) return { ok: false, error: rate.error, status: 429 };
  if (activeLedger.wouldExceedCap(ownerId, input.n)) {
    const summary = activeLedger.summary(ownerId);
    return {
      ok: false,
      error: `Daily Imagine cap reached (${summary.count}/${summary.dailyCap} images today). Try again tomorrow or raise MIND_IMAGINE_DAILY_CAP.`,
      status: 429,
    };
  }
  return { ok: true };
}
