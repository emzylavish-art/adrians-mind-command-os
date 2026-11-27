export type SpeechProviderChoice = "xai" | "openai" | `custom:${string}`;
export type VoiceStages = { inputProvider: SpeechProviderChoice | "handy"; answerProvider: "chat"; outputProvider: SpeechProviderChoice | "browser" };
export const VOICE_STAGES_KEY = "amcos.voice.stages.v1";
export const DEFAULT_VOICE_STAGES: VoiceStages = { inputProvider: "xai", answerProvider: "chat", outputProvider: "xai" };
export function isSpeechProviderChoice(value: unknown): value is SpeechProviderChoice {
  return value === "xai" || value === "openai" || (typeof value === "string" && /^custom:[a-f0-9-]{36}$/i.test(value));
}

/** Pass the account-owned preference adapter, not global browser storage. */
export function loadVoiceStages(storage: Pick<Storage, "getItem"> | null | undefined): VoiceStages {
  try {
    const raw = storage?.getItem(VOICE_STAGES_KEY);
    const value = raw ? JSON.parse(raw) : {};
    return { inputProvider: value.inputProvider === "handy" || isSpeechProviderChoice(value.inputProvider) ? value.inputProvider : "xai", answerProvider: "chat", outputProvider: value.outputProvider === "browser" || isSpeechProviderChoice(value.outputProvider) ? value.outputProvider : "xai" };
  } catch { return { ...DEFAULT_VOICE_STAGES }; }
}

export type SelectedSpeechCredential = { ok: true; provider: "xai" | "openai"; key: string } | { ok: false; error: string };
