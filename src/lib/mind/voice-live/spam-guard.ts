/**
 * Single-flight / cancel-budget / transcript dedupe for live voice.
 * Ideas ported from Voice Integration Bot spam-guard.ts (voice-integration lane).
 */

export type FlightGate = { inflight: boolean; generation: number };

export function createFlightGate(): FlightGate {
  return { inflight: false, generation: 0 };
}

/** Begin a single-flight operation. Returns null if already inflight. */
export function beginFlight(gate: FlightGate): { generation: number } | null {
  if (gate.inflight) return null;
  gate.inflight = true;
  gate.generation += 1;
  return { generation: gate.generation };
}

export function endFlight(gate: FlightGate, generation: number): void {
  if (gate.generation === generation) gate.inflight = false;
}

export function isCurrentFlight(gate: FlightGate, generation: number): boolean {
  return gate.generation === generation;
}

export type CancelBudget = { windowStartMs: number; count: number };
export const CANCEL_BUDGET_WINDOW_MS = 3_000;
export const CANCEL_BUDGET_MAX = 8;

export function createCancelBudget(now = Date.now()): CancelBudget {
  return { windowStartMs: now, count: 0 };
}

/** Returns whether another cancel/barge-in is allowed in the window. */
export function allowCancel(budget: CancelBudget, now = Date.now()): boolean {
  if (now - budget.windowStartMs > CANCEL_BUDGET_WINDOW_MS) {
    budget.windowStartMs = now;
    budget.count = 0;
  }
  if (budget.count >= CANCEL_BUDGET_MAX) return false;
  budget.count += 1;
  return true;
}

export type TranscriptDedupe = { last: string; atMs: number };
export const TRANSCRIPT_DEDUPE_TTL_MS = 2_000;

export function createTranscriptDedupe(): TranscriptDedupe {
  return { last: "", atMs: 0 };
}

export function shouldAcceptTranscript(
  dedupe: TranscriptDedupe,
  text: string,
  now = Date.now(),
  ttlMs = TRANSCRIPT_DEDUPE_TTL_MS,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed === dedupe.last && now - dedupe.atMs < ttlMs) return false;
  dedupe.last = trimmed;
  dedupe.atMs = now;
  return true;
}

export const SECRET_EXPIRY_SKEW_MS = 15_000;

export function secretNeedsRemint(expiresAtMs: number, now = Date.now(), skewMs = SECRET_EXPIRY_SKEW_MS): boolean {
  if (!expiresAtMs || expiresAtMs <= 0) return true;
  return now >= expiresAtMs - skewMs;
}

/** Cap reconnect attempts (WS drop). */
export const MAX_RECONNECT_ATTEMPTS = 3;

export function nextReconnectDelayMs(attempt: number): number {
  // attempt 1 → 400, 2 → 800, 3 → 1600
  const n = Math.max(1, Math.min(MAX_RECONNECT_ATTEMPTS, attempt));
  return 200 * 2 ** n;
}
