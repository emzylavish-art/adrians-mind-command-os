/**
 * Per-owner Imagine spend ledger (server-oriented; memory backend for tests).
 * Estimates are approximate — update when xAI publishes stable image pricing.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { CorruptStateFileError, writeFileAtomic, withFileLock, type FileLockOptions } from "./file-atomic.ts";

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
  /** Reservation id (present for reserve()-created events). */
  id?: string;
  /**
   * "reserved" = slot held before the upstream call (counts toward the cap);
   * "settled" = charge kept. Legacy events without a status count as settled.
   */
  status?: "reserved" | "settled";
};

export type ImagineSpendSummary = {
  ownerId: string;
  day: string; // YYYY-MM-DD UTC
  count: number;
  byModel: Record<string, number>;
  estimatedCostUsd: number;
  dailyCap: number;
  remaining: number;
  /** True when the backing store is unreadable — summary is fail-closed (remaining 0). */
  unavailable?: boolean;
};

export type ImagineSpendReservation =
  | { ok: true; id: string; summary: ImagineSpendSummary }
  | { ok: false; reason: "cap" | "unavailable"; summary: ImagineSpendSummary };

export type ImagineSpendLedger = {
  /** Append a settled charge (legacy / seeding). Throws when the store is unavailable. */
  record(input: { ownerId: string; model: string; n: number; at?: number }): ImagineSpendEvent;
  /**
   * Atomically check the cap AND hold a pending slot in one synchronous step.
   * Call before any await that leads to upstream spend.
   */
  reserve(input: { ownerId: string; model: string; n: number; at?: number }): ImagineSpendReservation;
  /** Keep a reserved charge (success or ambiguous failure). Optional model update for the estimate. */
  settle(id: string, update?: { model?: string }): boolean;
  /** Drop a reservation — only when the upstream definitely did not bill. */
  refund(id: string): boolean;
  summary(ownerId: string, now?: number): ImagineSpendSummary;
  wouldExceedCap(ownerId: string, n: number, now?: number): boolean;
};

/**
 * Pluggable persistence for the event ledger. `transact` must run `fn` as one
 * atomic read-modify-write (synchronously, no awaits) and throw when the stored
 * state is unreadable — never substitute an empty ledger.
 */
export type ImagineSpendLedgerBackend = {
  read(): ImagineSpendEvent[];
  transact<T>(fn: (events: ImagineSpendEvent[]) => { events?: ImagineSpendEvent[]; result: T }): T;
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

function failClosedSummary(ownerId: string, now: number): ImagineSpendSummary {
  const dailyCap = getImagineDailyCap();
  return {
    ownerId,
    day: dayKey(now),
    count: dailyCap,
    byModel: {},
    estimatedCostUsd: 0,
    dailyCap,
    remaining: 0,
    unavailable: true,
  };
}

function makeEvent(input: { ownerId: string; model: string; n: number; at?: number }): ImagineSpendEvent {
  const n = Math.max(1, Math.floor(input.n));
  return {
    ownerId: input.ownerId,
    model: input.model,
    n,
    at: input.at ?? Date.now(),
    estimatedCostUsd: estimateImagineCostUsd(input.model, n),
  };
}

function newReservationId(): string {
  return `rsv_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

/** Build a ledger on top of any atomic backend (memory, file, or a future shared store). */
export function createSpendLedgerFromBackend(backend: ImagineSpendLedgerBackend): ImagineSpendLedger {
  return {
    record(input) {
      const event = { ...makeEvent(input), status: "settled" as const };
      backend.transact((events) => ({ events: [...events, event], result: undefined }));
      return event;
    },
    reserve(input) {
      const now = input.at ?? Date.now();
      try {
        return backend.transact<ImagineSpendReservation>((events) => {
          const summary = summarize(events, input.ownerId, now);
          if (summary.count + Math.max(1, Math.floor(input.n)) > summary.dailyCap) {
            return { result: { ok: false, reason: "cap", summary } };
          }
          const event: ImagineSpendEvent = { ...makeEvent({ ...input, at: now }), id: newReservationId(), status: "reserved" };
          const next = [...events, event];
          return { events: next, result: { ok: true, id: event.id!, summary: summarize(next, input.ownerId, now) } };
        });
      } catch {
        return { ok: false, reason: "unavailable", summary: failClosedSummary(input.ownerId, now) };
      }
    },
    settle(id, update) {
      try {
        return backend.transact((events) => {
          const index = events.findIndex((event) => event.id === id);
          if (index < 0) return { result: false };
          const prev = events[index]!;
          const model = update?.model || prev.model;
          const next = [...events];
          next[index] = { ...prev, model, status: "settled", estimatedCostUsd: estimateImagineCostUsd(model, prev.n) };
          return { events: next, result: true };
        });
      } catch {
        return false; // reservation stays counted
      }
    },
    refund(id) {
      try {
        return backend.transact((events) => {
          const index = events.findIndex((event) => event.id === id && event.status === "reserved");
          if (index < 0) return { result: false };
          return { events: events.filter((_, i) => i !== index), result: true };
        });
      } catch {
        return false; // could not refund — charge stays (fail closed)
      }
    },
    summary(ownerId, now = Date.now()) {
      try {
        return summarize(backend.read(), ownerId, now);
      } catch {
        return failClosedSummary(ownerId, now);
      }
    },
    wouldExceedCap(ownerId, n, now = Date.now()) {
      try {
        const s = summarize(backend.read(), ownerId, now);
        return s.count + Math.max(1, n) > s.dailyCap;
      } catch {
        return true;
      }
    },
  };
}

export function createMemorySpendLedger(seed: ImagineSpendEvent[] = []): ImagineSpendLedger {
  let events = [...seed];
  return createSpendLedgerFromBackend({
    read: () => events,
    transact(fn) {
      const out = fn(events);
      if (out.events) events = out.events;
      return out.result;
    },
  });
}

function isEvent(value: unknown): value is ImagineSpendEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return typeof e.ownerId === "string" && typeof e.model === "string" && typeof e.n === "number" && typeof e.at === "number";
}

const RETAIN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * File-backed ledger: O_EXCL lock + temp-file/rename writes so several server
 * processes on one host share one consistent count. Corrupt/unreadable JSON
 * fails CLOSED (no spend, remaining 0) and the file is never overwritten.
 */
export function createFileSpendLedger(filePath: string, lockOptions: FileLockOptions = {}): ImagineSpendLedger {
  function readAll(): ImagineSpendEvent[] {
    if (!existsSync(filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      throw new CorruptStateFileError(filePath);
    }
    const events = parsed && typeof parsed === "object" ? (parsed as { events?: unknown }).events : undefined;
    if (!Array.isArray(events) || !events.every(isEvent)) throw new CorruptStateFileError(filePath);
    return events;
  }
  function writeAll(events: ImagineSpendEvent[]) {
    const cutoff = Date.now() - RETAIN_MS;
    const trimmed = events.filter((event) => event.at >= cutoff);
    writeFileAtomic(filePath, JSON.stringify({ events: trimmed }));
  }
  return createSpendLedgerFromBackend({
    read: readAll,
    transact(fn) {
      return withFileLock(
        filePath,
        () => {
          const out = fn(readAll());
          if (out.events) writeAll(out.events);
          return out.result;
        },
        lockOptions,
      );
    },
  });
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

/**
 * Check-only (rate limit + cap). Does NOT hold a slot — concurrent callers can all pass.
 * Spend paths must use reserveImagineSpend instead. Kept for compatibility.
 */
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

/**
 * Rate-limit + atomic daily-cap reservation in ONE synchronous step (no await),
 * so N concurrent requests at cap-1 cannot all pass. Caller must later
 * settle (charge kept) or refund (upstream definitely did not bill).
 */
export function reserveImagineSpend(input: {
  ownerId: string;
  sessionId?: string;
  n: number;
  model: string;
  checkRateLimit: (key: string) => { ok: true } | { ok: false; error: string; retryAfterSec: number };
  rateLimitKey: (parts: { ownerId: string; sessionId?: string }) => string;
}): { ok: true; reservationId: string } | { ok: false; error: string; status: number } {
  const ownerId = input.ownerId.trim();
  if (!ownerId) return { ok: false, error: "Imagine requires an owner id for spend controls.", status: 400 };
  const rate = input.checkRateLimit(input.rateLimitKey({ ownerId, sessionId: input.sessionId }));
  if (!rate.ok) return { ok: false, error: rate.error, status: 429 };
  const reservation = activeLedger.reserve({ ownerId, model: input.model, n: input.n });
  if (reservation.ok) return { ok: true, reservationId: reservation.id };
  if (reservation.reason === "unavailable") {
    return {
      ok: false,
      error: "Imagine spend tracking is unavailable, so generation is paused to protect your budget. Try again shortly.",
      status: 503,
    };
  }
  return {
    ok: false,
    error: `Daily Imagine cap reached (${reservation.summary.count}/${reservation.summary.dailyCap} images today). Try again tomorrow or raise MIND_IMAGINE_DAILY_CAP.`,
    status: 429,
  };
}
