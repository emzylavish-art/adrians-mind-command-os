/** Adversarial mic/overlay spam guards — pure helpers for session lifecycle. */

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

/** Idempotent mute: only apply when value changes. */
export function nextMuteState(current: boolean, desired: boolean): { changed: boolean; muted: boolean } {
  if (current === desired) return { changed: false, muted: current };
  return { changed: true, muted: desired };
}

/** Toggle mute idempotently from spam clicks. */
export function toggleMute(current: boolean): boolean {
  return !current;
}

export type CancelBudget = { windowStartMs: number; count: number };
export const CANCEL_BUDGET_WINDOW_MS = 3_000;
export const CANCEL_BUDGET_MAX = 4;

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

/** Transcript dedupe: ignore identical transcript within TTL. */
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

/** Speak queue: coalesce overlapping force_message — only one pending speak at a time besides active. */
export type SpeakQueue = { active: string | null; pending: string | null };

export function createSpeakQueue(): SpeakQueue {
  return { active: null, pending: null };
}

export function enqueueSpeak(queue: SpeakQueue, text: string): "start" | "replace_pending" | "ignore" {
  const trimmed = text.trim();
  if (!trimmed) return "ignore";
  if (!queue.active) {
    queue.active = trimmed;
    return "start";
  }
  if (trimmed === queue.active) return "ignore";
  queue.pending = trimmed;
  return "replace_pending";
}

export function completeSpeak(queue: SpeakQueue): string | null {
  queue.active = null;
  const next = queue.pending;
  queue.pending = null;
  if (next) {
    queue.active = next;
    return next;
  }
  return null;
}

/** Client secret expiry: re-mint when within skew of expiresAt. */
export const SECRET_EXPIRY_SKEW_MS = 15_000;

export function secretNeedsRemint(expiresAtMs: number, now = Date.now(), skewMs = SECRET_EXPIRY_SKEW_MS): boolean {
  if (!expiresAtMs || expiresAtMs <= 0) return true;
  return now >= expiresAtMs - skewMs;
}

/** Assert media tracks ended after cleanup. */
export function allTracksEnded(stream: { getTracks(): { readyState: string }[] } | null | undefined): boolean {
  if (!stream) return true;
  return stream.getTracks().every((t) => t.readyState === "ended");
}
