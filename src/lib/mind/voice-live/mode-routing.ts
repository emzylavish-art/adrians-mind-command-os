import type { VoiceRoutingMode } from "../voice/mode.ts";

/** Session instructions that match Direct vs Orchestrator routing. */
export function liveVoiceInstructionsForMode(mode: VoiceRoutingMode): string {
  return mode === "orchestrator"
    ? "You are a silent speech-to-text capture helper. Do not speak replies; only transcribe the user."
    : "You are a helpful voice assistant. Keep spoken replies concise.";
}

/**
 * Whether a late Orchestrator conductor result should still be spoken.
 * Re-read mode after awaits so rapid toggles cannot mis-route audio.
 */
export function shouldSpeakOrchestratorResult(
  modeAtSpeak: VoiceRoutingMode,
  sessionAlive: boolean,
): boolean {
  return sessionAlive && modeAtSpeak === "orchestrator";
}
