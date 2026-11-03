/**
 * Pure poll-state reducer for the dashboard status hook.
 *
 * Rules:
 *  - first load failure → soft "error" that UI overlays (never requires blanking the stage forever);
 *    callers keep retrying with backoff and may hydrate from lastGood
 *  - failure after data → keep last data, mark `stale` with reason + since (never silently green)
 *  - responses with a sequence older than the last applied one are dropped
 */
export type PollState<T> =
  | { status: "loading"; seq: number }
  | { status: "error"; error: string; seq: number; lastData: T | null }
  | { status: "ready"; data: T; seq: number; stale: null | { error: string; since: string } };

export type PollEvent<T> =
  | { type: "success"; seq: number; data: T }
  | { type: "failure"; seq: number; error: string; at?: string };

export function initialPollState<T>(): PollState<T> {
  return { status: "loading", seq: 0 };
}

export function reducePoll<T>(prev: PollState<T>, ev: PollEvent<T>): PollState<T> {
  if (!Number.isFinite(ev.seq) || ev.seq <= prev.seq) return prev; // out-of-order / duplicate
  if (ev.type === "success") {
    return { status: "ready", data: ev.data, seq: ev.seq, stale: null };
  }
  const error = String(ev.error ?? "unknown error").slice(0, 300) || "unknown error";
  if (prev.status === "ready") {
    return {
      status: "ready",
      data: prev.data,
      seq: ev.seq,
      stale: prev.stale ?? { error, since: ev.at ?? new Date().toISOString() },
    };
  }
  const lastData = prev.status === "error" ? prev.lastData : null;
  return { status: "error", error, seq: ev.seq, lastData };
}

/** Prefer live ready data; else lastData on error; else null. */
export function pollViewData<T>(state: PollState<T>): T | null {
  if (state.status === "ready") return state.data;
  if (state.status === "error") return state.lastData;
  return null;
}

export function nextBackoffMs(failCount: number, baseMs = 1000, capMs = 20_000): number {
  const n = Number.isFinite(failCount) ? Math.max(0, Math.min(20, Math.floor(failCount))) : 0;
  const ms = baseMs * Math.pow(2, n);
  return Math.min(capMs, Math.max(baseMs, ms));
}
