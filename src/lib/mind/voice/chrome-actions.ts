/**
 * ChatPane composer-voice-chrome actions (VOICE-02).
 * Keep presentational chrome honest: Speak → TTS, Live speak → live session,
 * Voice mode → Direct realtime overlay. No fake success.
 */

import type { VoiceOverlayPhase } from "@/components/mind/voice-mode-overlay";
import type { VoiceUiState } from "@/components/mind/voice-ui";
import type { LiveSpeakState } from "@/components/mind/voice-ui";

export type ChromeSpeakDecision =
  | { action: "speak"; text: string; note: string }
  | { action: "none"; note: string };

/** ComposerBar Speak → existing speakText / TTS path for the last assistant reply. */
export function decideChromeSpeak(input: {
  lastReplyContent?: string | null;
  speaking: boolean;
}): ChromeSpeakDecision {
  if (input.speaking) {
    return { action: "none", note: "Already speaking the last reply." };
  }
  const text = (input.lastReplyContent ?? "").trim();
  if (!text) {
    return { action: "none", note: "Nothing to speak yet. Send a chat message first." };
  }
  return {
    action: "speak",
    text,
    note: "Speaking last reply via the speech API (not a live voice session).",
  };
}

/** Map Direct overlay phase → VoiceModeStage presentational state. */
export function mapOverlayPhaseToStageState(phase: VoiceOverlayPhase | null | undefined): VoiceUiState {
  switch (phase) {
    case "listening":
    case "requesting_mic":
    case "getting_session":
    case "connecting":
      return "listening";
    case "processing":
      return "thinking";
    case "speaking":
      return "speaking";
    case "interrupted":
      return "interrupted";
    case "error":
    case "idle":
    default:
      return "idle";
  }
}

/** ComposerBar speakState from TTS speaking flag (not live session). */
export function chromeSpeakState(speaking: boolean): LiveSpeakState {
  return speaking ? "assistant-speaking" : "off";
}

export const CHROME_VOICE_READY_NOTE =
  "Dictate uses this chat’s microphone. Speak reads the last reply aloud. Live speak starts a live voice session. Voice mode opens Direct realtime.";
