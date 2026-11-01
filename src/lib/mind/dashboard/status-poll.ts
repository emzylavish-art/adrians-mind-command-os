/**
 * Pure poll-state reducer for the dashboard status hook.
 *
 * Hacker-pass (2026-11-01 c8): before this, ONE failed poll (server restart, git timeout,
 * transient 500) flipped state to "error", which unmounted <UniverseScene/> and tore down the
 * whole WebGL context (camera position lost, GPU re-init every 5 s while the API flapped).
 * Polls were also fired on a fixed interval with no in-flight guard, so slow responses
 * (git timeout 15 s) piled up and could land out of order, overwriting newer data with older.
 *
 * Rules:
 *  - first load failure → honest "error"
 *  - failure after data → keep last data, mark `stale` with reason + since (never silently green)
 *  - responses with a sequence older than the last applied one are dropped
 */
export type PollState<T> =
  | { status: "loading"; seq: number }
  | { status: "error"; error: string; seq: number }
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
  return { status: "error", error, seq: ev.seq };
}
