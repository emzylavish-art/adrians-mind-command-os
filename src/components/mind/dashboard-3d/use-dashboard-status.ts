import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardStatus } from "@/lib/mind/dashboard/types";
import { initialPollState, reducePoll, type PollState } from "@/lib/mind/dashboard/status-poll";

export type StatusData = DashboardStatus & { ok?: boolean };
export type StatusState = PollState<StatusData>;

const POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 20_000;

export function useDashboardStatus() {
  const [state, setState] = useState<StatusState>(() => initialPollState<StatusData>());
  const seqRef = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // In-flight guard: never stack polls (slow git calls used to pile up).
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
      setState((prev) => reducePoll(prev, { type: "success", seq, data }));
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      const error = aborted ? "Status request timed out/aborted" : err instanceof Error ? err.message : String(err);
      setState((prev) => reducePoll(prev, { type: "failure", seq, error, at: new Date().toISOString() }));
    } finally {
      window.clearTimeout(timer);
      if (inFlight.current === ac) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearInterval(id);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  return { state, refresh };
}
