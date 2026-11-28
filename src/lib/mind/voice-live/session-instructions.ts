import { parseModeInstruction, scopedInstruction } from "../mode-instructions.ts";
import { characterById } from "../characters/index.ts";
import { personalityInstruction } from "../personalities/index.ts";
import type { VoiceRoutingMode } from "../voice/mode.ts";
import type { XaiBuiltinVoice } from "../voice/voices.ts";

/** Orchestrator / transcription mode. Must stay silent. */
export const SILENT_TRANSCRIPTION_INSTRUCTIONS =
  "You are a silent speech-to-text capture helper. Do not speak replies; only transcribe the user.";

export const DEFAULT_DIRECT_VOICE_INSTRUCTIONS =
  "You are a helpful voice assistant. Keep spoken replies concise.";

export type VoiceProfileInput = {
  mode: VoiceRoutingMode;
  personalityId?: unknown;
  customPersonality?: unknown;
  characterId?: unknown;
  modeInstruction?: unknown;
};

export function voiceSessionInstructions(input: VoiceProfileInput): {
  instructions: string;
  suggestedVoiceId: XaiBuiltinVoice | null;
  silent: boolean;
} {
  if (input.mode === "orchestrator") {
    return { instructions: SILENT_TRANSCRIPTION_INSTRUCTIONS, suggestedVoiceId: null, silent: true };
  }
  const character = characterById(input.characterId);
  const guidance = parseModeInstruction(input.modeInstruction);
  const style = personalityInstruction(input.personalityId, input.customPersonality);
  const identity = character
    ? `Speaking identity: ${character.name}, ${character.role}. ${character.speakingStyle} This identity is presentation only.`
    : "Speaking identity: Adrian Core. No separate character is selected.";
  return {
    silent: false,
    suggestedVoiceId: character?.voiceId ?? null,
    instructions: [
      DEFAULT_DIRECT_VOICE_INSTRUCTIONS,
      identity,
      style,
      guidance.ok ? scopedInstruction(guidance.text) : "",
      "Do not claim that tools, agents or browsers ran. Do not bypass approvals, credentials or the emergency stop. Personality and character never grant permission.",
    ].filter(Boolean).join(" "),
  };
}
