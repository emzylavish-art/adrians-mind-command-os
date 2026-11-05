/**
 * Barge-in cutoff helpers for live voice.
 * Echo-guard idea credited to Voice Integration Bot barge-in.ts.
 */

import type { BargeInSource } from "../voice/speak-state/events.ts";

export type { BargeInSource };

export const BARGE_IN_ECHO_GUARD_MS = 400;

export type BargeInCutoffResult = {
  cut: boolean;
  sendCancel: boolean;
  reason: "speech_started" | "echo_guard" | "budget_exhausted" | "idle";
};

/**
 * Decide whether speech_started should cut assistant playback.
 * While within echo-guard after assistant audio began, ignore (TTS echo).
 */
export function decideBargeInCutoff(input: {
  assistantPlaying: boolean;
  speakingStartedAtMs: number | null;
  nowMs: number;
  cancelAllowed: boolean;
  echoGuardMs?: number;
}): BargeInCutoffResult {
  if (!input.assistantPlaying) {
    return { cut: false, sendCancel: false, reason: "idle" };
  }
  const guard = input.echoGuardMs ?? BARGE_IN_ECHO_GUARD_MS;
  const started = input.speakingStartedAtMs ?? 0;
  if (started > 0 && input.nowMs - started < guard) {
    return { cut: false, sendCancel: false, reason: "echo_guard" };
  }
  if (!input.cancelAllowed) {
    return { cut: false, sendCancel: false, reason: "budget_exhausted" };
  }
  return { cut: true, sendCancel: true, reason: "speech_started" };
}

/**
 * Raised local-VAD probability required before speech can barge in on TTS.
 * Sits above typical echo at the live RMS threshold (~0.12 → vad ~0.54).
 */
export const TTS_VAD_BARGE_PROB = 0.72;

/** Local speech must stay above TTS_VAD_BARGE_PROB this long before a VAD barge-in. */
export const TTS_VAD_SUSTAIN_MS = 280;

export type SpeakBargeReason =
  | "manual"
  | "esc"
  | "speech_started"
  | "echo_guard"
  | "below_threshold"
  | "not_sustained"
  | "idle"
  | "budget_exhausted";

export type SpeakBargeDecision = {
  fire: boolean;
  source: BargeInSource;
  reason: SpeakBargeReason;
};

/**
 * Speak-state barge-in decision.
 * Manual and Esc always fire.
 * Server VAD (no vadProb) keeps decideBargeInCutoff, including the 400 ms echo guard.
 * Local VAD adds a raised threshold and a sustain window on top of that guard so
 * TTS echo cannot self-trigger after the guard expires.
 */
export function decideSpeakBargeIn(input: {
  source: BargeInSource;
  assistantPlaying: boolean;
  speakingStartedAtMs: number | null;
  nowMs: number;
  cancelAllowed?: boolean;
  echoGuardMs?: number;
  /** Omit for server speech_started. Present for local RMS/VAD. */
  vadProb?: number;
  sustainedMs?: number;
  sustainMs?: number;
  vadThreshold?: number;
}): SpeakBargeDecision {
  if (input.source === "manual" || input.source === "esc") {
    return { fire: true, source: input.source, reason: input.source };
  }
  const cutoff = decideBargeInCutoff({
    assistantPlaying: input.assistantPlaying,
    speakingStartedAtMs: input.speakingStartedAtMs,
    nowMs: input.nowMs,
    cancelAllowed: input.cancelAllowed ?? true,
    echoGuardMs: input.echoGuardMs,
  });
  if (!cutoff.cut) {
    return { fire: false, source: "vad", reason: cutoff.reason };
  }
  if (input.vadProb == null) {
    return { fire: true, source: "vad", reason: "speech_started" };
  }
  const threshold = input.vadThreshold ?? TTS_VAD_BARGE_PROB;
  const sustain = input.sustainMs ?? TTS_VAD_SUSTAIN_MS;
  if (input.vadProb < threshold) {
    return { fire: false, source: "vad", reason: "below_threshold" };
  }
  if ((input.sustainedMs ?? 0) < sustain) {
    return { fire: false, source: "vad", reason: "not_sustained" };
  }
  return { fire: true, source: "vad", reason: "speech_started" };
}
