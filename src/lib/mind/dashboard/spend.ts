/**
 * Queue #7 — MONEY / spend adapter (Dashboard Bot).
 *
 * Discovers REAL spend logs only (JSON/JSONL under allowlisted roots).
 * Never invents amounts. If no source exists → available:false,
 * reason "no spend source yet".
 *
 * Hacker: drop NaN/±Infinity/negative; reject currency overflow; mark stale.
 *
 * Future plug-in: implement SpendAdapter.load or drop a file matching
 * SPEND_FILE_RE with records { at|atIso, amountUsd|usd|cost_usd }.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseTimeMs } from "./health.ts";

export const NO_SPEND_SOURCE = "no spend source yet";
export const MAX_AMOUNT_USD = 1_000_000; // overflow ceiling for a single event
export const MAX_EVENTS = 5_000;
export const STALE_MS = 24 * 60 * 60 * 1000;
export const BURN_WINDOW_MS = 60 * 60 * 1000; // 1h window for burn/hr
/** Warnings fire only when real today-total crosses these (USD). */
export const WARN_TODAY_USD = 25;
export const CRIT_TODAY_USD = 100;

export const SPEND_FILE_RE = /spend|usage|cost|billing/i;
export const SPEND_EXT_RE = /\.(json|jsonl|ndjson|log|csv)$/i;

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
  /** Load real events; must not fabricate. */
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
  /** WAT day key used for "today" (Africa/Lagos). */
  todayKey: string | null;
};

const DEFAULT_ROOTS = [
  "/workspace",
  "/workspace/.handoff",
  "/workspace/audit/dashboard-3d",
  "/workspace/mind-command-os-xai",
  "/workspace/mind-command-os-dashboard/.handoff",
];

function watDayKey(ms: number): string {
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

/** Sanitize a single amount: finite, >=0, <= MAX_AMOUNT_USD. */
export function sanitizeAmountUsd(raw: unknown): number | null {
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return sanitizeAmountUsd(n);
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
  // Nested usage.cost
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

/** Parse one JSON object into a SpendEvent (or null if invalid). */
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
  if (currencyRaw && currencyRaw !== "USD") return null; // only USD for now — don't invent FX
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

  // JSON array or object with entries/events/records
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
        // single record object
        pushRow(data);
        return { events, droppedInvalid };
      }
    } catch {
      // fall through to line mode
    }
  }

  // JSONL / log lines
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
    // CSV-ish: at,amountUsd
    const parts = l.split(/[,\t]/);
    if (parts.length >= 2) {
      pushRow({ at: parts[0], amountUsd: parts[1], lane: parts[2], model: parts[3] });
    } else {
      droppedInvalid += 1;
    }
  }
  return { events, droppedInvalid };
}

const MAX_FILE_BYTES = 2_000_000;

/** Default filesystem adapter — scans allowlisted roots for spend-like files. */
export function createFilesystemSpendAdapter(opts?: { roots?: string[] }): SpendAdapter {
  const roots = opts?.roots ?? DEFAULT_ROOTS;
  return {
    id: "filesystem-spend",
    load(ctx: SpendLoadContext = {}): SpendLoadResult {
      const nowMs = Number.isFinite(ctx.nowMs) ? (ctx.nowMs as number) : Date.now();
      const exists = ctx.exists ?? existsSync;
      const listNames = ctx.listNames ?? ((dir: string) => readdirSync(dir));
      const readText = ctx.readText ?? ((path: string) => readFileSync(path, "utf8"));
      const statSize =
        ctx.statSize ??
        ((path: string) => {
          try {
            return statSync(path).size;
          } catch {
            return 0;
          }
        });
      const searchRoots = ctx.roots ?? roots;

      const hits: string[] = [];
      for (const root of searchRoots) {
        try {
          if (!exists(root)) continue;
          for (const name of listNames(root)) {
            if (!SPEND_FILE_RE.test(name) || !SPEND_EXT_RE.test(name)) continue;
            hits.push(join(root, name));
          }
          // one level of *xai* children under /workspace
          if (root === "/workspace") {
            for (const name of listNames(root)) {
              if (!/xai/i.test(name)) continue;
              const dir = join(root, name);
              try {
                for (const f of listNames(dir)) {
                  if (!SPEND_FILE_RE.test(f) || !SPEND_EXT_RE.test(f)) continue;
                  hits.push(join(dir, f));
                }
              } catch {
                /* skip */
              }
            }
          }
        } catch {
          /* skip root */
        }
      }

      if (!hits.length) {
        return { ok: false, reason: NO_SPEND_SOURCE };
      }

      const all: SpendEvent[] = [];
      let droppedInvalid = 0;
      const used: string[] = [];
      for (const path of hits.slice(0, 8)) {
        try {
          if (statSize(path) > MAX_FILE_BYTES) {
            droppedInvalid += 1;
            continue;
          }
          const text = readText(path);
          const parsed = parseSpendFileText(text, path, nowMs);
          droppedInvalid += parsed.droppedInvalid;
          if (parsed.events.length) {
            all.push(...parsed.events);
            used.push(path);
          }
        } catch {
          droppedInvalid += 1;
        }
      }

      if (!all.length) {
        // Files matched by name but held no usable USD rows (e.g. token-only logs)
        return {
          ok: false,
          reason: NO_SPEND_SOURCE,
          droppedInvalid,
        };
      }

      all.sort((a, b) => b.atMs - a.atMs);
      const events = all.slice(0, MAX_EVENTS);
      return {
        ok: true,
        events,
        source: used.join(" · "),
        droppedInvalid,
      };
    },
  };
}

export type BuildMoneyInput = {
  loadResult: SpendLoadResult;
  nowMs?: number;
  warnTodayUsd?: number;
  critTodayUsd?: number;
  staleMs?: number;
  burnWindowMs?: number;
};

/** Pure: turn loaded events into burn / today / warnings (or empty). */
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
  // Round to cents for display stability (still real sum)
  todayTotalUsd = Math.round(todayTotalUsd * 100) / 100;
  const burnPerHourUsd = Math.round(burnSum * 100) / 100;

  const warnings: MoneyWarning[] = [];
  // Warnings only from real today total — never when empty/unavailable
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
    burnPerHourUsd: stale ? null : burnPerHourUsd, // don't report burn from stale feeds
    warnings: stale ? [] : warnings, // stale → no active threshold warnings
    asOfMs,
    eventCount: events.length,
    stale,
    droppedInvalid: input.loadResult.droppedInvalid,
    todayKey,
  };
}

/** Convenience: filesystem adapter + money view for status builders. */
export function loadMoneyView(
  env: { nowMs?: number; adapter?: SpendAdapter } = {},
): MoneyView {
  const adapter = env.adapter ?? createFilesystemSpendAdapter();
  const loadResult = adapter.load({ nowMs: env.nowMs });
  return buildMoneyView({ loadResult, nowMs: env.nowMs });
}
