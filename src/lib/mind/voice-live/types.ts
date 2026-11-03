/** Live voice session types — Visual Polish data-live-voice contract. */

export type LiveVoiceUiAttr =
  | "off"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "assistant-speaking"
  | "interrupted"
  | "muted"
  | "error";

export type LiveVoiceLabel =
  | "Connecting"
  | "Listening"
  | "You're speaking"
  | "Thinking"
  | "Speaking"
  | "Muted"
  | "Error"
  | "Off";

/** Internal machine phase (richer than the CSS attr). */
export type LiveVoicePhase =
  | "off"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "assistant_speaking"
  | "interrupted"
  | "muted"
  | "error"
  | "reconnecting";

export type LiveVoicePublicState = {
  phase: LiveVoicePhase;
  uiAttr: LiveVoiceUiAttr;
  label: LiveVoiceLabel;
  level: number;
  muted: boolean;
  error: string | null;
  active: boolean;
  modeBadge: "Direct" | "Orchestrator";
  /** True while finals are routing into an active BuildSession. */
  steeringBuild: boolean;
};

export function phaseToUiAttr(phase: LiveVoicePhase, muted: boolean): LiveVoiceUiAttr {
  if (phase === "off") return "off";
  if (phase === "error") return "error";
  if (muted) return "muted";
  switch (phase) {
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "listening":
    case "thinking":
      return "listening";
    case "user_speaking":
      return "user-speaking";
    case "assistant_speaking":
      return "assistant-speaking";
    case "interrupted":
      return "interrupted";
    case "muted":
      return "muted";
    default:
      return "listening";
  }
}

export function phaseToLabel(phase: LiveVoicePhase, muted: boolean): LiveVoiceLabel {
  if (phase === "off") return "Off";
  if (phase === "error") return "Error";
  if (muted && phase !== "connecting" && phase !== "reconnecting") return "Muted";
  switch (phase) {
    case "connecting":
    case "reconnecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "user_speaking":
      return "You're speaking";
    case "thinking":
      return "Thinking";
    case "assistant_speaking":
      return "Speaking";
    case "interrupted":
      return "You're speaking";
    case "muted":
      return "Muted";
    default:
      return "Listening";
  }
}

export const LIVE_LEVEL_THROTTLE_MS = 66; // ~15 Hz

export function throttleLiveLevel(prevMs: number, nowMs: number, level: number): { emit: boolean; value: number; at: number } {
  const value = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
  // prevMs <= 0 means "never emitted yet" — always publish the first sample.
  if (prevMs > 0 && nowMs - prevMs < LIVE_LEVEL_THROTTLE_MS) return { emit: false, value, at: prevMs };
  return { emit: true, value, at: nowMs };
}
