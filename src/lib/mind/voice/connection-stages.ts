/** Explicit Direct/Orchestrator voice connection stages with per-stage timeouts. */

export type VoiceConnectStage =
  | "idle"
  | "requesting_mic"
  | "getting_session"
  | "connecting"
  | "listening"
  | "error";

export type VoiceConnectState = {
  stage: VoiceConnectStage;
  status: string;
  error: string | null;
};

export const VOICE_STAGE_TIMEOUT_MS = 10_000;

export const VOICE_STAGE_LABEL: Record<VoiceConnectStage, string> = {
  idle: "Voice mode",
  requesting_mic: "Requesting mic…",
  getting_session: "Getting session…",
  connecting: "Connecting…",
  listening: "Listening…",
  error: "Connection failed",
};

export function createVoiceConnectState(): VoiceConnectState {
  return { stage: "idle", status: VOICE_STAGE_LABEL.idle, error: null };
}

export function enterStage(stage: Exclude<VoiceConnectStage, "error">): VoiceConnectState {
  return { stage, status: VOICE_STAGE_LABEL[stage], error: null };
}

export function failStage(stage: VoiceConnectStage, error: string): VoiceConnectState {
  return {
    stage: "error",
    status: VOICE_STAGE_LABEL.error,
    error: `${VOICE_STAGE_LABEL[stage === "error" ? "idle" : stage]} failed: ${error}`,
  };
}

export function stageTimeoutMessage(stage: VoiceConnectStage): string {
  const label = VOICE_STAGE_LABEL[stage] || "Voice";
  return `${label.replace(/…$/, "")} timed out after ${VOICE_STAGE_TIMEOUT_MS / 1000}s. Check mic permission, sign-in, and the voice key, then Retry.`;
}

export function normalizeVoiceConnectError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught || "Unknown error");
  if (message === "Unauthorized" || /unauthorized/i.test(message)) {
    return "Sign in is required to start voice (local preview: set VITE_AUTH_ENABLED=false in .grok/app-env.json).";
  }
  return message;
}
