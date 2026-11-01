export type VoicePersonality = "new" | "adrian" | "assistant" | "therapist";
export type VoiceActivation = "default" | "isolation" | "push_to_talk";
export type VoiceSpeed = "slow" | "normal" | "fast";

export type VoiceSettings = {
  personality: VoicePersonality;
  activation: VoiceActivation;
  speed: VoiceSpeed;
  audioSource: string;
  microphoneId: string;
  openInVoiceMode: boolean;
  /** Documented xAI voice id when provider path is available. */
  voiceId: "eve" | "ara" | "default";
};

export const VOICE_SETTINGS_KEY = "amcos.voice.settings.v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  personality: "adrian",
  activation: "default",
  speed: "normal",
  audioSource: "default",
  microphoneId: "",
  openInVoiceMode: false,
  voiceId: "eve",
};

export function loadVoiceSettings(storage: Pick<Storage, "getItem"> | null | undefined): VoiceSettings {
  try {
    const raw = storage?.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(storage: Pick<Storage, "setItem"> | null | undefined, next: VoiceSettings): void {
  try {
    storage?.setItem(VOICE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode may refuse */
  }
}

export function personalityPrompt(personality: VoicePersonality): string {
  if (personality === "new") return "You are a fresh assistant with no assumed history.";
  if (personality === "adrian") return "You are Adrian's Mind. Speak as Adrian's personal command assistant.";
  if (personality === "assistant") return "You are a concise helpful assistant.";
  return "You are a calm, supportive therapist-style listener. You do not diagnose.";
}

/** Fields stored for later live-voice wiring. Not consumed by browser speech. */
export const VOICE_SETTINGS_UNUSED_UNTIL_LIVE = [
  "personality",
  "activation",
  "speed",
  "openInVoiceMode",
  "voiceId",
  "audioSource",
] as const;

export function unusedUntilLiveNotice(): string {
  return "Saved; not used until live voice is connected.";
}

export function liveVoiceMissingNotice(hasServerKey: boolean): string {
  if (!hasServerKey) {
    return "No XAI_API_KEY is configured on the server. Live voice was not started. Nothing was invented.";
  }
  return "No live voice session is available. Live voice was not started.";
}
