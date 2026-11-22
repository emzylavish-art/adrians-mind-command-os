export const SOKUJI_SOURCE = "https://github.com/kizuna-ai-lab/sokuji";
export const OPUS_MT_SOURCE = "https://github.com/Helsinki-NLP/Opus-MT";
export const REJECTED_GOOGLE_TRANSLATOR = "https://github.com/SamirPaulb/real-time-voice-translator";
export const OPUS_MT_URL = "http://127.0.0.1:4197/opus-mt";

export const TRANSLATOR_TARGETS = [
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "pt", label: "Portuguese" },
  { id: "zh", label: "Chinese" },
] as const;

const PREVIEW: Record<string, Record<string, string>> = {
  hello: { es: "hola", fr: "bonjour", de: "hallo", pt: "olá", zh: "你好" },
  "what time is it?": { es: "¿Qué hora es?", fr: "Quelle heure est-il ?", de: "Wie spät ist es?", pt: "Que horas são?", zh: "现在几点？" },
};

export function voiceHostAllowed(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "translate.google.com" || host.endsWith(".google.com") || host.endsWith(".googleapis.com") || host.endsWith(".gstatic.com")) return false;
  return host.length > 0;
}

export type VoiceTranslation = {
  engine: "sokuji";
  model: "opus-mt";
  source: string;
  modelSource: string;
  weightsLoaded: boolean;
  google: false;
  target: string;
  text: string | null;
  note: string;
  pair?: string;
};

export function translateVoice(text: string, target = "es", fetchImpl: typeof fetch = fetch) {
  return translateWithOpus(text, target, fetchImpl);
}

export async function translateWithOpus(
  text: string,
  target = "es",
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceTranslation> {
  const base = {
    engine: "sokuji" as const,
    model: "opus-mt" as const,
    source: SOKUJI_SOURCE,
    modelSource: OPUS_MT_SOURCE,
    google: false as const,
    target,
  };
  const spoken = text.trim();
  if (!spoken) {
    return { ...base, weightsLoaded: false, text: null, note: "Nothing to translate. Nothing was sent to Google." };
  }
  try {
    const response = await fetchImpl(OPUS_MT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: spoken, target }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json() as {
      ok?: boolean;
      text?: string;
      note?: string;
      pair?: string;
      weightsLoaded?: boolean;
      error?: string;
    };
    const translated = body.text?.trim() ?? "";
    if (response.ok && body.ok && body.weightsLoaded && translated) {
      return {
        ...base,
        weightsLoaded: true,
        text: translated,
        pair: body.pair,
        note: body.note || "Translated by Opus-MT. Nothing was sent to Google.",
      };
    }
    return {
      ...base,
      weightsLoaded: false,
      text: null,
      pair: body.pair,
      note: body.error || "Opus-MT weights are not loaded on this machine. Nothing was sent to Google.",
    };
  } catch {
    return {
      ...base,
      weightsLoaded: false,
      text: null,
      note: "Opus-MT is not running on this machine. Nothing was sent to Google.",
    };
  }
}

export function previewPhrase(text: string, target = "es") {
  const key = text.trim().toLowerCase();
  const preview = PREVIEW[key]?.[target] ?? null;
  return {
    engine: "sokuji" as const,
    model: "opus-mt" as const,
    source: SOKUJI_SOURCE,
    modelSource: OPUS_MT_SOURCE,
    weightsLoaded: false as const,
    google: false as const,
    target,
    text: preview,
    note: preview
      ? "Test phrase only. Opus-MT weights are not loaded. Nothing was sent to Google."
      : "Opus-MT weights are not loaded on this machine. Nothing was sent to Google.",
  };
}
