import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardStatus } from "@/lib/mind/dashboard/types";
import {
  initialPollState,
  nextBackoffMs,
  reducePoll,
  type PollState,
} from "@/lib/mind/dashboard/status-poll";
import { readStatusCache, writeStatusCache } from "@/lib/mind/dashboard/status-cache";
import { dedupeBotsById } from "@/lib/mind/dashboard/bot-normalize";

export type StatusData = DashboardStatus & { ok?: boolean };
export type StatusState = PollState<StatusData>;

const POLL_MS = 20_000;
const FETCH_TIMEOUT_MS = 20_000;

export function useDashboardStatus() {
  const [state, setState] = useState<StatusState>(() => {
    // Gap #13: hydrate from session last-good so a reload during outage keeps the scene.
    try {
      const cached = typeof sessionStorage !== "undefined" ? readStatusCache<StatusData>(sessionStorage) : null;
      if (cached) {
        return {
          status: "ready",
          data: cached.data,
          seq: 0,
          stale: { error: "Showing cached last-good from this browser session", since: cached.savedAt },
        };
      }
    } catch {
      /* private mode */
    }
    return initialPollState<StatusData>();
  });
  const seqRef = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const lastGoodRef = useRef<StatusData | null>(null);
  const failCountRef = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const stopped = useRef(false);
  if (lastGoodRef.current == null && state.status === "ready") {
    lastGoodRef.current = state.data;
  }

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const ac = new AbortController();
    inFlight.current = ac;
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/mind/dashboard/status", { signal: ac.signal, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error((text || `HTTP ${res.status}`).slice(0, 300));
      }
      const data = (await res.json()) as StatusData & { error?: string };
      if (data.ok === false) throw new Error(data.error || "Status endpoint failed");
      if (!data || !Array.isArray(data.bots)) throw new Error("Malformed status payload");
      // Gap #12: normalize sparse section bags so UI optional chains stay honest.
      const normalized = {
        ...data,
        bots: dedupeBotsById(data.bots),
        spend: data.spend ?? { available: false as const, reason: "no spend source yet" },
        money: data.money ?? { available: false as const, reason: "no spend source yet", eventCount: 0 },
        notionGraph: data.notionGraph ?? { available: false, mode: "empty", reason: "no notion graph", pages: [], edges: [], botPageMap: {}, stats: { pages: 0, edges: 0 } },
        weather: data.weather ?? { label: "—", summary: "weather unavailable" },
        skyFeed: data.skyFeed ?? [],
        projects: data.projects ?? null,
        timeline: data.timeline ?? { events: [], earliestMs: null, latestMs: null, droppedFuture: 0, droppedInvalid: 0, truncated: false },
      } as StatusData;
      lastGoodRef.current = normalized;
      failCountRef.current = 0;
      try {
        if (typeof sessionStorage !== "undefined") writeStatusCache(sessionStorage, normalized);
      } catch {
        /* ignore quota */
      }
      setState((prev) => reducePoll(prev, { type: "success", seq, data: normalized }));
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      // Gap#9: React StrictMode / effect cleanup abort is not a user-facing error.
      if (aborted && stopped.current) return;
      if (aborted && !lastGoodRef.current && failCountRef.current === 0) {
        // First-load self-abort → stay loading; schedule will retry (pending, not error).
        return;
      }
      const error = aborted ? "Status request timed out" : err instanceof Error ? err.message : String(err);
      failCountRef.current += 1;
      setState((prev) => {
        // If we already have ready data, reducePoll keeps it stale — never wipe.
        const next = reducePoll(prev, { type: "failure", seq, error, at: new Date().toISOString() });
        if (next.status === "error" && !next.lastData && lastGoodRef.current) {
          return { ...next, lastData: lastGoodRef.current };
        }
        return next;
      });
    } finally {
      window.clearTimeout(timer);
      if (inFlight.current === ac) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    const schedule = () => {
      if (stopped.current) return;
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
      const failing = failCountRef.current > 0;
      const delay = failing ? nextBackoffMs(failCountRef.current - 1) : 0; // immediate first tick
      retryTimer.current = window.setTimeout(() => {
        void refresh().finally(() => {
          if (stopped.current) return;
          const nextDelay = failCountRef.current > 0 ? nextBackoffMs(failCountRef.current - 1) : POLL_MS;
          retryTimer.current = window.setTimeout(() => {
            void refresh().finally(scheduleNext);
          }, nextDelay);
        });
      }, delay);
    };
    const scheduleNext = () => {
      if (stopped.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
      const nextDelay = failCountRef.current > 0 ? nextBackoffMs(failCountRef.current - 1) : POLL_MS;
      retryTimer.current = window.setTimeout(() => {
        void refresh().finally(scheduleNext);
      }, nextDelay);
    };
    // First fetch immediately, then poll / backoff loop.
    void refresh().finally(scheduleNext);
    const onVis = () => {
      if (document.hidden) {
        // Gap#25: pause timers while hidden — no background status hammering.
        if (retryTimer.current != null) {
          window.clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }
        return;
      }
      // Visible again: immediate fetch, then resume schedule.
      void refresh().finally(scheduleNext);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopped.current = true;
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  return { state, refresh };
}
