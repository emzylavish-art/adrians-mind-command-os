/** Where a voice-overlay transcript should go (not dictation). */

export type VoiceTranscriptRouting = {
  /** Overlay / notice copy of what was heard. */
  overlayTranscript: string;
  /** Composer draft must stay empty — voice turns belong in chat. */
  composerDraft: string;
  /** True when Direct/Orchestrator should create chat turns. */
  sendAsChatTurn: boolean;
};

export function routeVoiceModeTranscript(transcript: string): VoiceTranscriptRouting {
  const text = transcript.trim();
  return {
    overlayTranscript: text,
    composerDraft: "",
    sendAsChatTurn: Boolean(text),
  };
}
