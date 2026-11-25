/**
 * Per-owner Imagine spend ledger (server-oriented; memory backend for tests).
 * Estimates are approximate — update when xAI publishes stable image pricing.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
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
  resetAt: string;
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
  if (!Number.isFinite(n) || n < 0) return 0;
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
    resetAt: new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString(),
  };
}

export function createFileSpendLedger(filePath: string): ImagineSpendLedger {
  function readAll(): ImagineSpendEvent[] {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { events?: ImagineSpendEvent[] };
      if (!Array.isArray(parsed.events) || !parsed.events.every((e) => e && typeof e.ownerId === "string" && typeof e.model === "string" && Number.isInteger(e.n) && e.n > 0 && Number.isFinite(e.at) && Number.isFinite(e.estimatedCostUsd))) throw new Error("Unreadable image allowance history.");
      return parsed.events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  function writeAll(events: ImagineSpendEvent[]) {
    mkdirSync(dirname(filePath), { recursive: true });
    // Keep ~14 days
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const trimmed = events.filter((event) => event.at >= cutoff);
    const temp = filePath + "." + crypto.randomUUID();
    writeFileSync(temp, JSON.stringify({ events: trimmed }), "utf8");
    renameSync(temp, filePath);
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

let testLedger: ImagineSpendLedger | null = null;

export function setImagineSpendLedger(ledger: ImagineSpendLedger) {
  testLedger = ledger;
}

export function resetImagineSpendLedgerForTests() {
  testLedger = createMemorySpendLedger();
}

type Attempt = { ownerId: string; model: string; n: number };
type StoredAttempt = { id: string; model: string; n: number; at_ms: number; confirmed: boolean };

async function durableSql() {
  const { getSql, dbSource } = await import("../../db.ts");
  if (process.env.VERCEL && dbSource === "pglite") throw new Error("Shared usage storage is unavailable.");
  return getSql();
}

async function dayUsage(sql: import("../../db.ts").Sql, ownerId: string, now: number) {
  // Include pre-migration, file-backed usage until the UTC day rolls over.
  const legacy = createFileSpendLedger(DEFAULT_SPEND_LEDGER_PATH).summary(ownerId, now);
  const rows = await sql<StoredAttempt>`select id, model, n, at_ms, confirmed from mind_imagine_attempts where owner_id = ${ownerId} and day = ${legacy.day}`;
  let unknown = 0;
  for (const row of rows) {
    legacy.count += row.n;
    legacy.byModel[row.model] = (legacy.byModel[row.model] ?? 0) + row.n;
    legacy.estimatedCostUsd += estimateImagineCostUsd(row.model, row.n);
    if (!row.confirmed) unknown += row.n;
  }
  legacy.remaining = Math.max(0, legacy.dailyCap - legacy.count);
  return { ...legacy, estimatedCostUsd: Math.round(legacy.estimatedCostUsd * 1000) / 1000, unconfirmed: unknown };
}

export async function imagineUsage(ownerId: string) {
  if (testLedger) return { ...testLedger.summary(ownerId), unconfirmed: 0 };
  return dayUsage(await durableSql(), ownerId, Date.now());
}

/** Reserve before dispatch. Failure after dispatch leaves the allowance consumed and the outcome unconfirmed. */
export async function reserveImagine(input: Attempt): Promise<{ ok: true; confirm: () => Promise<void> } | { ok: false; error: string; status: number }> {
  const ownerId = input.ownerId.trim();
  if (!ownerId) return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
  const capped = { ok: false as const, status: 429, error: "Daily Imagine cap reached. Check the remaining allowance." };
  try {
    if (testLedger) {
      if (testLedger.wouldExceedCap(ownerId, input.n)) return capped;
      testLedger.record(input);
      return { ok: true, confirm: async () => {} };
    }
    const sql = await durableSql();
    if (!sql.transaction) throw new Error("A transactional allowance ledger is required.");
    const now = Date.now();
    const day = dayKey(now);
    const id = crypto.randomUUID();
    return await sql.transaction(async (tx) => {
      await tx`insert into mind_imagine_days (owner_id, day) values (${ownerId}, ${day}) on conflict do nothing`;
      await tx`select day from mind_imagine_days where owner_id = ${ownerId} and day = ${day} for update`;
      const summary = await dayUsage(tx, ownerId, now);
      if (summary.remaining < input.n) return capped;
      await tx`insert into mind_imagine_attempts (id, owner_id, day, model, n, at_ms) values (${id}, ${ownerId}, ${day}, ${input.model}, ${input.n}, ${now})`;
      return { ok: true as const, confirm: async () => {
        // The reservation already counts. A reporting outage should not discard the delivered image.
        try { await sql`update mind_imagine_attempts set confirmed = true where id = ${id}`; }
        catch { /* An unconfirmed reservation remains visible. */ }
      }};
    });
  } catch {
    return { ok: false, status: 503, error: "Image usage could not be verified. The provider request was paused." };
  }
}
