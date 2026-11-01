/** Pure barge-in / interruption cutoff state machine for voice overlay. */

export type BargeInPhase = "idle" | "listening" | "speaking" | "interrupted";

export type BargeInState = {
  phase: BargeInPhase;
  status: string;
  /** ms of continuous local RMS above threshold while speaking */
  hotMs: number;
  /** ms elapsed since speaking started (for echo-guard + min visible) */
  speakingElapsedMs: number;
};

export type BargeInAction =
  | { type: "session_listening" }
  | { type: "session_speaking" }
  | { type: "session_idle" }
  | { type: "speech_started" }
  | { type: "local_rms"; level: number; dtMs: number }
  | { type: "manual_interrupt" }
  | { type: "resume_listening" }
  | { type: "tick"; dtMs: number };

export const BARGE_IN_RMS_THRESHOLD = 0.12;
export const BARGE_IN_HOLD_MS = 150;
/** Ignore mic/VAD barge-in briefly so TTS echo cannot cut itself off. */
export const BARGE_IN_ECHO_GUARD_MS = 900;
/** Keep Speaking visible long enough for testers to hit Interrupt. */
export const SPEAKING_MIN_VISIBLE_MS = 900;

export function createBargeInState(): BargeInState {
  return { phase: "idle", status: "Voice mode", hotMs: 0, speakingElapsedMs: 0 };
}

export function isInEchoGuard(state: BargeInState): boolean {
  return state.phase === "speaking" && state.speakingElapsedMs < BARGE_IN_ECHO_GUARD_MS;
}

export function speakingMinVisibleMet(state: BargeInState): boolean {
  return state.phase === "speaking" && state.speakingElapsedMs >= SPEAKING_MIN_VISIBLE_MS;
}

export function reduceBargeIn(state: BargeInState, action: BargeInAction): BargeInState {
  switch (action.type) {
    case "session_listening":
      return { phase: "listening", status: "Listening…", hotMs: 0, speakingElapsedMs: 0 };
    case "session_speaking":
      return { phase: "speaking", status: "Speaking…", hotMs: 0, speakingElapsedMs: 0 };
    case "session_idle":
      return { phase: "idle", status: "Voice mode", hotMs: 0, speakingElapsedMs: 0 };
    case "tick": {
      if (state.phase !== "speaking") return state;
      return {
        ...state,
        speakingElapsedMs: state.speakingElapsedMs + Math.max(0, action.dtMs),
      };
    }
    case "speech_started":
      if (state.phase !== "speaking") {
        return state.phase === "interrupted"
          ? state
          : { phase: "listening", status: "Listening…", hotMs: 0, speakingElapsedMs: 0 };
      }
      // Server VAD during playback — honor only after echo-guard so TTS does not barge itself in.
      if (isInEchoGuard(state)) return state;
      return { phase: "interrupted", status: "Interrupted — listening", hotMs: 0, speakingElapsedMs: 0 };
    case "manual_interrupt":
      if (state.phase !== "speaking" && state.phase !== "interrupted") return state;
      return { phase: "interrupted", status: "Interrupted — listening", hotMs: 0, speakingElapsedMs: 0 };
    case "local_rms": {
      if (state.phase !== "speaking") return { ...state, hotMs: 0 };
      const speakingElapsedMs = state.speakingElapsedMs + Math.max(0, action.dtMs);
      const nextBase = { ...state, speakingElapsedMs };
      if (isInEchoGuard(nextBase)) return { ...nextBase, hotMs: 0 };
      if (action.level < BARGE_IN_RMS_THRESHOLD) return { ...nextBase, hotMs: 0 };
      const hotMs = state.hotMs + Math.max(0, action.dtMs);
      if (hotMs >= BARGE_IN_HOLD_MS) {
        return { phase: "interrupted", status: "Interrupted — listening", hotMs: 0, speakingElapsedMs: 0 };
      }
      return { ...nextBase, hotMs };
    }
    case "resume_listening":
      return { phase: "listening", status: "Listening…", hotMs: 0, speakingElapsedMs: 0 };
    default:
      return state;
  }
}

/** True when the machine just crossed into interrupted and playback must be cut. */
export function shouldCutPlayback(prev: BargeInState, next: BargeInState): boolean {
  return prev.phase === "speaking" && next.phase === "interrupted";
}
