/**
 * Queue #7 — MONEY pure core (safe for client imports).
 * No node:fs — filesystem adapter lives in spend.ts (server only).
 */
import { parseTimeMs } from "./health.ts";

export const NO_SPEND_SOURCE = "no spend source yet";
export const MAX_AMOUNT_USD = 1_000_000;
export const MAX_EVENTS = 5_000;
export const STALE_MS = 24 * 60 * 60 * 1000;
export const BURN_WINDOW_MS = 60 * 60 * 1000;
export const WARN_TODAY_USD = 25;
export const CRIT_TODAY_USD = 100;

export type SpendEvent = {
  atIso: string;
  atMs: number;
  amountUsd: number;
  currency: "USD";
  lane: string | null;
  model: string | null;
  source: string;
};

export type SpendLoadResult =
  | { ok: true; events: SpendEvent[]; source: string; droppedInvalid: number }
  | { ok: false; reason: string; droppedInvalid?: number };

export type SpendAdapter = {
  id: string;
  load: (ctx?: SpendLoadContext) => SpendLoadResult;
};

export type SpendLoadContext = {
  nowMs?: number;
  roots?: string[];
  readText?: (path: string) => string;
  listNames?: (dir: string) => string[];
  exists?: (path: string) => boolean;
  statSize?: (path: string) => number;
};

export type MoneyWarning = {
  level: "warn" | "crit";
  message: string;
  thresholdUsd: number;
  observedUsd: number;
};

export type MoneyView = {
  available: boolean;
  reason: string | null;
  source: string | null;
  currency: "USD";
  todayTotalUsd: number | null;
  burnPerHourUsd: number | null;
  warnings: MoneyWarning[];
  asOfMs: number | null;
  eventCount: number;
  stale: boolean;
  droppedInvalid: number;
  todayKey: string | null;
};

export function watDayKey(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function sanitizeAmountUsd(raw: unknown): number | null {
  if (typeof raw === "string" && raw.trim() !== "") {
    return sanitizeAmountUsd(Number(raw));
  }
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  if (raw > MAX_AMOUNT_USD) return null;
  return raw;
}

function pickAmount(row: Record<string, unknown>): number | null {
  const keys = ["amountUsd", "amount_usd", "usd", "cost_usd", "costUsd", "spend_usd", "spendUsd"];
  for (const k of keys) {
    if (k in row) {
      const v = sanitizeAmountUsd(row[k]);
      if (v != null) return v;
    }
  }
  const usage = row.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    for (const k of keys) {
      if (k in u) {
        const v = sanitizeAmountUsd(u[k]);
        if (v != null) return v;
      }
    }
  }
  return null;
}

function pickAt(row: Record<string, unknown>, nowMs: number): { atIso: string; atMs: number } | null {
  const keys = ["atIso", "at", "timestamp", "time", "date", "createdAt", "created_at"];
  for (const k of keys) {
    const v = row[k];
    if (typeof v !== "string" && typeof v !== "number") continue;
    const iso = typeof v === "number" ? new Date(v).toISOString() : v;
    const atMs = parseTimeMs(String(iso), nowMs);
    if (atMs == null) continue;
    return { atIso: String(iso), atMs };
  }
  return null;
}

export function parseSpendRecord(
  row: unknown,
  source: string,
  nowMs = Date.now(),
): SpendEvent | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const amountUsd = pickAmount(r);
  const when = pickAt(r, nowMs);
  if (amountUsd == null || !when) return null;
  const currencyRaw = String(r.currency ?? r.Currency ?? "USD").toUpperCase();
  if (currencyRaw && currencyRaw !== "USD") return null;
  const lane =
    typeof r.lane === "string"
      ? r.lane
      : typeof r.botId === "string"
        ? r.botId
        : typeof r.bot === "string"
          ? r.bot
          : null;
  const model = typeof r.model === "string" ? r.model : null;
  return {
    atIso: when.atIso,
    atMs: when.atMs,
    amountUsd,
    currency: "USD",
    lane,
    model,
    source,
  };
}

export function parseSpendFileText(text: string, source: string, nowMs = Date.now()): {
  events: SpendEvent[];
  droppedInvalid: number;
} {
  const events: SpendEvent[] = [];
  let droppedInvalid = 0;
  const trimmed = text.trim();
  if (!trimmed) return { events, droppedInvalid };

  const pushRow = (row: unknown) => {
    const ev = parseSpendRecord(row, source, nowMs);
    if (!ev) {
      droppedInvalid += 1;
      return;
    }
    events.push(ev);
  };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (Array.isArray(data)) {
        for (const row of data) pushRow(row);
        return { events, droppedInvalid };
      }
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const list = obj.entries ?? obj.events ?? obj.records ?? obj.spend ?? obj.costs;
        if (Array.isArray(list)) {
          for (const row of list) pushRow(row);
          return { events, droppedInvalid };
        }
        pushRow(data);
        return { events, droppedInvalid };
      }
    } catch {
      /* line mode */
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    if (l.startsWith("{")) {
      try {
        pushRow(JSON.parse(l));
      } catch {
        droppedInvalid += 1;
      }
      continue;
    }
    const parts = l.split(/[,\t]/);
    if (parts.length >= 2) {
      pushRow({ at: parts[0], amountUsd: parts[1], lane: parts[2], model: parts[3] });
    } else {
      droppedInvalid += 1;
    }
  }
  return { events, droppedInvalid };
}

export type BuildMoneyInput = {
  loadResult: SpendLoadResult;
  nowMs?: number;
  warnTodayUsd?: number;
  critTodayUsd?: number;
  staleMs?: number;
  burnWindowMs?: number;
};

export function buildMoneyView(input: BuildMoneyInput): MoneyView {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const warnAt = Number.isFinite(input.warnTodayUsd) ? (input.warnTodayUsd as number) : WARN_TODAY_USD;
  const critAt = Number.isFinite(input.critTodayUsd) ? (input.critTodayUsd as number) : CRIT_TODAY_USD;
  const staleMs = Number.isFinite(input.staleMs) ? (input.staleMs as number) : STALE_MS;
  const burnWindowMs = Number.isFinite(input.burnWindowMs)
    ? (input.burnWindowMs as number)
    : BURN_WINDOW_MS;
  const todayKey = watDayKey(nowMs);

  if (!input.loadResult.ok) {
    return {
      available: false,
      reason: input.loadResult.reason || NO_SPEND_SOURCE,
      source: null,
      currency: "USD",
      todayTotalUsd: null,
      burnPerHourUsd: null,
      warnings: [],
      asOfMs: null,
      eventCount: 0,
      stale: false,
      droppedInvalid: input.loadResult.droppedInvalid ?? 0,
      todayKey,
    };
  }

  const events = input.loadResult.events;
  const asOfMs = events.length ? events[0]!.atMs : null;
  const stale = asOfMs == null ? true : nowMs - asOfMs > staleMs;

  let todayTotalUsd = 0;
  let burnSum = 0;
  for (const ev of events) {
    if (watDayKey(ev.atMs) === todayKey) todayTotalUsd += ev.amountUsd;
    if (nowMs - ev.atMs <= burnWindowMs) burnSum += ev.amountUsd;
  }
  todayTotalUsd = Math.round(todayTotalUsd * 100) / 100;
  const burnPerHourUsd = Math.round(burnSum * 100) / 100;

  const warnings: MoneyWarning[] = [];
  if (todayTotalUsd >= critAt) {
    warnings.push({
      level: "crit",
      message: `Today's spend $${todayTotalUsd.toFixed(2)} crossed critical $${critAt.toFixed(2)}`,
      thresholdUsd: critAt,
      observedUsd: todayTotalUsd,
    });
  } else if (todayTotalUsd >= warnAt) {
    warnings.push({
      level: "warn",
      message: `Today's spend $${todayTotalUsd.toFixed(2)} crossed warning $${warnAt.toFixed(2)}`,
      thresholdUsd: warnAt,
      observedUsd: todayTotalUsd,
    });
  }

  return {
    available: true,
    reason: null,
    source: input.loadResult.source,
    currency: "USD",
    todayTotalUsd,
    burnPerHourUsd: stale ? null : burnPerHourUsd,
    warnings: stale ? [] : warnings,
    asOfMs,
    eventCount: events.length,
    stale,
    droppedInvalid: input.loadResult.droppedInvalid,
    todayKey,
  };
}


/** Gap#34 — after a long hidden tab, wall-clock burn is misleading until a fresh visible window. */
export function adjustBurnForHiddenGap<T extends MoneyView>(
  money: T,
  hiddenGapMs: number,
  burnWindowMs = BURN_WINDOW_MS,
): T {
  if (!money?.available || money.burnPerHourUsd == null) return money;
  const gap = Number.isFinite(hiddenGapMs) ? Math.max(0, hiddenGapMs) : 0;
  if (gap < burnWindowMs * 0.5) return money;
  // Keep todayTotal; clear burn and surface why (no invented burn after lunch tab).
  return {
    ...money,
    burnPerHourUsd: null,
    warnings: [
      ...money.warnings,
      {
        level: "warn" as const,
        message: `Burn paused — tab was hidden ~${Math.round(gap / 60000)}m (Gap#34)`,
        thresholdUsd: burnWindowMs,
        observedUsd: gap,
      },
    ],
  };
}
