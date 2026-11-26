export type SpeechEngine = "browser" | "xai" | "openai";
export type CloudSpeechEngine = Exclude<SpeechEngine, "browser">;
export type VoiceRoutePreferences = {
  mode: "composed" | "native-xai";
  sttProvider: SpeechEngine;
  ttsProvider: SpeechEngine;
  /** Only the named alternate may receive audio after the primary fails. */
  sttFallbackProvider: CloudSpeechEngine | null;
};

export const DEFAULT_VOICE_ROUTE: Readonly<VoiceRoutePreferences> = {
  mode: "composed", sttProvider: "xai", ttsProvider: "xai", sttFallbackProvider: null,
};

const engine = (value: unknown): value is SpeechEngine => value === "browser" || value === "xai" || value === "openai";
export const cloudSpeechEngine = (value: unknown): value is CloudSpeechEngine => value === "xai" || value === "openai";
export const speechEngineLabel = (value: SpeechEngine): string => value === "browser" ? "Browser speech" : value === "xai" ? "xAI" : "OpenAI";
export const voiceRouteKey = (owner: string | null | undefined) => `amcos.voice.route.v1:${encodeURIComponent(owner || "signed-out")}`;

export function normalizeVoiceRoute(value: unknown): VoiceRoutePreferences {
  const saved = value && typeof value === "object" ? value as Partial<VoiceRoutePreferences> : {};
  const sttProvider = engine(saved.sttProvider) ? saved.sttProvider : DEFAULT_VOICE_ROUTE.sttProvider;
  return {
    mode: saved.mode === "native-xai" ? "native-xai" : "composed",
    sttProvider,
    ttsProvider: engine(saved.ttsProvider) ? saved.ttsProvider : DEFAULT_VOICE_ROUTE.ttsProvider,
    sttFallbackProvider: sttProvider !== "browser" && cloudSpeechEngine(saved.sttFallbackProvider) && saved.sttFallbackProvider !== sttProvider ? saved.sttFallbackProvider : null,
  };
}

export function readVoiceRoutePreferences(storage: Pick<Storage, "getItem"> | null | undefined, owner?: string | null): VoiceRoutePreferences {
  try { return normalizeVoiceRoute(JSON.parse(storage?.getItem(voiceRouteKey(owner)) || "null")); }
  catch { return { ...DEFAULT_VOICE_ROUTE }; }
}

export function writeVoiceRoutePreferences(storage: Pick<Storage, "setItem"> | null | undefined, owner: string | null | undefined, value: VoiceRoutePreferences): VoiceRoutePreferences {
  const next = normalizeVoiceRoute(value);
  try { storage?.setItem(voiceRouteKey(owner), JSON.stringify(next)); } catch { /* unavailable storage does not start a call */ }
  return next;
}

/** Legacy callers remain explicitly xAI-only; malformed destinations fail closed. */
export function parseCloudSpeechPolicy(body: Record<string, unknown>):
  | { ok: true; value: { provider: CloudSpeechEngine; fallbackProvider: CloudSpeechEngine | null } }
  | { ok: false; error: string } {
  const provider = body.provider === undefined ? "xai" : body.provider;
  const fallback = body.fallbackProvider ?? null;
  if (!cloudSpeechEngine(provider) || (fallback !== null && !cloudSpeechEngine(fallback))) {
    return { ok: false, error: "Choose xAI or OpenAI for this cloud speech request. No recording was sent." };
  }
  return { ok: true, value: { provider, fallbackProvider: fallback === provider ? null : fallback } };
}
