/** Explicit stages for recorded Speak; a text provider need not offer audio APIs. */
export type TranscriptionProvider = "xai" | "openai";
export type SpeechOutputProvider = "xai" | "browser";
export type VoicePipelinePreferences = {
  answerMode: "selected" | "realtime";
  transcription: TranscriptionProvider;
  speechOutput: SpeechOutputProvider;
};
export const DEFAULT_VOICE_PIPELINE: VoicePipelinePreferences = {
  answerMode: "selected", transcription: "xai", speechOutput: "browser",
};

export function voicePipelineStorageKey(ownerId: string): string {
  return `amcos.voice.pipeline.v1:${encodeURIComponent(ownerId)}`;
}

export function readVoicePipeline(ownerId: string | null, storage?: Pick<Storage, "getItem"> | null): VoicePipelinePreferences {
  if (!ownerId) return { ...DEFAULT_VOICE_PIPELINE };
  try {
    const value = JSON.parse(storage?.getItem(voicePipelineStorageKey(ownerId)) ?? "null") as Partial<VoicePipelinePreferences> | null;
    return {
      answerMode: value?.answerMode === "realtime" ? "realtime" : "selected",
      transcription: value?.transcription === "openai" ? "openai" : "xai",
      speechOutput: value?.speechOutput === "xai" ? "xai" : "browser",
    };
  } catch { return { ...DEFAULT_VOICE_PIPELINE }; }
}

export function writeVoicePipeline(ownerId: string | null, preference: VoicePipelinePreferences, storage?: Pick<Storage, "setItem"> | null): boolean {
  if (!ownerId || !storage) return false;
  try { storage.setItem(voicePipelineStorageKey(ownerId), JSON.stringify(preference)); return true; }
  catch { return false; }
}

export function voiceStagePlan(input: {
  preferences: VoicePipelinePreferences;
  selectedProvider: string;
  requestedModel?: string;
  freeOnly: boolean;
}): { ok: true; input: string; answer: string; output: string; model: string | null } | { ok: false; error: string } {
  if (input.freeOnly) return { ok: false, error: "Free-only mode keeps cloud transcription and realtime voice off. Browser dictation can insert text for the selected chat provider." };
  if (input.preferences.answerMode === "realtime") return { ok: true, input: "xAI realtime", answer: "xAI realtime", output: "xAI realtime", model: "grok-voice-latest" };
  if (!input.selectedProvider.trim()) return { ok: false, error: "Choose a connected answer provider before starting Speak." };
  return {
    ok: true,
    input: input.preferences.transcription === "openai" ? "OpenAI" : "xAI",
    answer: input.selectedProvider,
    output: input.preferences.speechOutput === "browser" ? "Browser speech" : "xAI",
    model: input.requestedModel || null,
  };
}

/** Playback is a separate stage; rejection must not resend the already committed answer. */
export function speakWithBrowser(input: {
  text: string;
  signal: AbortSignal;
  volume?: number;
  rate?: number;
  synthesis?: Pick<SpeechSynthesis, "speak" | "cancel">;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
}): Promise<void> {
  if (input.signal.aborted) return Promise.reject(new DOMException("Speech canceled", "AbortError"));
  const synthesis = input.synthesis ?? (typeof window !== "undefined" ? window.speechSynthesis : undefined);
  if (!synthesis) return Promise.reject(new Error("Browser speech is unavailable. The text reply is still saved."));
  return new Promise((resolve, reject) => {
    const utterance = input.makeUtterance ? input.makeUtterance(input.text) : new SpeechSynthesisUtterance(input.text);
    utterance.volume = Math.max(0, Math.min(1, input.volume ?? 1));
    utterance.rate = Math.max(0.5, Math.min(2, input.rate ?? 1));
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => { synthesis.cancel(); finish(new DOMException("Speech canceled", "AbortError")); };
    utterance.onend = () => finish();
    utterance.onerror = () => finish(new Error("Browser speech could not play. The text reply is still saved."));
    input.signal.addEventListener("abort", abort, { once: true });
    try { synthesis.speak(utterance); } catch { finish(new Error("Browser speech could not start. The text reply is still saved.")); }
  });
}
