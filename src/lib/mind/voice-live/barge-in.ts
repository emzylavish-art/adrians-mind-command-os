/**
 * Barge-in cutoff helpers for live voice.
 * Echo-guard idea credited to Voice Integration Bot barge-in.ts.
 */

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
