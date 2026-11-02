/**
 * Flush localStorage intent outcome queue to POST /api/intent/outcomes.
 * No-op when signed out. Clears only acknowledged items.
 */
import { INTENT_OUTCOMES_KEY, MAX_STORED_OUTCOMES } from "./outcome-reporter.ts";
import { MAX_OUTCOME_BATCH } from "./outcome-validate.ts";
import type { IntentOutcome } from "./types.ts";

export type OutcomeQueueStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type QueuedOutcome = IntentOutcome & {
  clientId: string;
  patternId?: string;
};

export type FlushFetch = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type FlushResult = {
  skipped: boolean;
  reason?: "signed-out" | "empty" | "unauthorized" | "unavailable" | "error";
  sent: number;
  cleared: number;
  inserted?: number;
};

function fingerprint(outcome: IntentOutcome, index: number): string {
  return `c-${outcome.intentId}-${outcome.at}-${outcome.accepted ? 1 : 0}-${index}`;
}

export function readOutcomeQueue(store: OutcomeQueueStore | null): QueuedOutcome[] {
  if (!store) return [];
  try {
    const raw = store.getItem(INTENT_OUTCOMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: QueuedOutcome[] = [];
    parsed.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      const r = row as Partial<IntentOutcome> & { clientId?: string; patternId?: string };
      if (typeof r.intentId !== "string" || typeof r.accepted !== "boolean") return;
      if (typeof r.at !== "number" || !Number.isFinite(r.at)) return;
      out.push({
        intentId: r.intentId,
        accepted: r.accepted,
        source: r.source === "voice" ? "voice" : "keystroke",
        query: typeof r.query === "string" ? r.query : "",
        score: typeof r.score === "number" ? r.score : 0,
        at: r.at,
        patternId: typeof r.patternId === "string" ? r.patternId : undefined,
        clientId: typeof r.clientId === "string" && r.clientId ? r.clientId : fingerprint(r as IntentOutcome, index),
      });
    });
    return out;
  } catch {
    return [];
  }
}

export function writeOutcomeQueue(store: OutcomeQueueStore | null, rows: QueuedOutcome[]): void {
  if (!store) return;
  try {
    const clipped = rows.slice(-MAX_STORED_OUTCOMES);
    store.setItem(INTENT_OUTCOMES_KEY, JSON.stringify(clipped));
  } catch {
    /* ignore */
  }
}

export function removeAcknowledged(
  queue: QueuedOutcome[],
  acknowledged: unknown,
): QueuedOutcome[] {
  const ids = new Set(
    Array.isArray(acknowledged)
      ? acknowledged.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  );
  if (ids.size === 0) return queue;
  return queue.filter((row) => !ids.has(row.clientId));
}

/**
 * Flush up to MAX_OUTCOME_BATCH queued outcomes. Leaves the queue untouched on
 * 401/503 so a later signed-in / healthy pass can retry.
 */
export async function flushIntentOutcomeQueue(options: {
  store: OutcomeQueueStore | null;
  isSignedIn: boolean;
  endpoint?: string;
  fetchImpl?: FlushFetch;
  headers?: Record<string, string>;
}): Promise<FlushResult> {
  if (!options.isSignedIn) {
    return { skipped: true, reason: "signed-out", sent: 0, cleared: 0 };
  }
  const queue = readOutcomeQueue(options.store);
  if (queue.length === 0) {
    return { skipped: true, reason: "empty", sent: 0, cleared: 0 };
  }

  const batch = queue.slice(0, MAX_OUTCOME_BATCH);
  const endpoint = options.endpoint ?? "/api/intent/outcomes";
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FlushFetch);

  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({
        items: batch.map((row) => ({
          intentId: row.intentId,
          patternId: row.patternId,
          hit: row.accepted,
          observedAt: row.at,
          note: row.query ? `q=${row.query.slice(0, 120)}` : undefined,
          clientId: row.clientId,
        })),
      }),
    });
  } catch {
    return { skipped: true, reason: "error", sent: batch.length, cleared: 0 };
  }

  if (response.status === 401) {
    return { skipped: true, reason: "unauthorized", sent: batch.length, cleared: 0 };
  }
  if (response.status === 503) {
    return { skipped: true, reason: "unavailable", sent: batch.length, cleared: 0 };
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    acknowledged?: string[];
    inserted?: number;
  } | null;

  if (!response.ok || !body?.ok) {
    return { skipped: true, reason: "error", sent: batch.length, cleared: 0 };
  }

  // Prefer server ack list; if omitted/empty, clear the sent batch by clientId.
  const ack =
    Array.isArray(body.acknowledged) && body.acknowledged.length > 0
      ? body.acknowledged
      : batch.map((r) => r.clientId);
  const remaining = removeAcknowledged(queue, ack);
  const cleared = queue.length - remaining.length;
  writeOutcomeQueue(options.store, remaining);

  return {
    skipped: false,
    sent: batch.length,
    cleared,
    inserted: typeof body.inserted === "number" ? body.inserted : undefined,
  };
}

export type OutcomeFlushScheduler = {
  stop: () => void;
  flushNow: () => Promise<FlushResult>;
};

/**
 * Flush on idle (requestIdleCallback / timeout) and visibilitychange → visible/hidden.
 */
export function installOutcomeFlushScheduler(options: {
  getIsSignedIn: () => boolean;
  store?: OutcomeQueueStore | null;
  endpoint?: string;
  fetchImpl?: FlushFetch;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  idleMs?: number;
}): OutcomeFlushScheduler {
  const store =
    options.store === undefined
      ? typeof localStorage === "undefined"
        ? null
        : localStorage
      : options.store;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleHandle: number | null = null;

  const flushNow = async (): Promise<FlushResult> => {
    if (stopped) return { skipped: true, reason: "empty", sent: 0, cleared: 0 };
    const headers = options.getHeaders ? await options.getHeaders() : {};
    return flushIntentOutcomeQueue({
      store,
      isSignedIn: options.getIsSignedIn(),
      endpoint: options.endpoint,
      fetchImpl: options.fetchImpl,
      headers,
    });
  };

  const scheduleIdle = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    if (typeof cancelIdleCallback === "function" && idleHandle != null) {
      cancelIdleCallback(idleHandle);
      idleHandle = null;
    }
    const run = () => {
      void flushNow();
    };
    const delay = options.idleMs ?? 2500;
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(() => run(), { timeout: delay + 2000 });
    } else {
      timer = setTimeout(run, delay);
    }
  };

  const onVis = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void flushNow();
      return;
    }
    scheduleIdle();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }
  scheduleIdle();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof cancelIdleCallback === "function" && idleHandle != null) {
        cancelIdleCallback(idleHandle);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    },
    flushNow,
  };
}
