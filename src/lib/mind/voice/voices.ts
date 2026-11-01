/**
 * Official built-in xAI voice IDs from docs.x.ai Voice Overview.
 * Source: https://docs.x.ai/docs/guides/voice (Available Voices / voice table)
 * Also listed under Speech to Speech: https://docs.x.ai/developers/model-capabilities/audio/voice
 * eve is the documented default.
 */

export const XAI_VOICE_DOCS_URL = "https://docs.x.ai/docs/guides/voice";

export const DEFAULT_XAI_VOICE = "eve" as const;

/** Curated built-in allowlist used by the picker and server TTS/realtime. */
export const XAI_BUILTIN_VOICES = [
  "ara",
  "eve",
  "leo",
  "rex",
  "sal",
  "altair",
  "atlas",
  "aurora",
  "carina",
  "castor",
  "celeste",
  "cosmo",
  "helios",
  "helix",
  "iris",
  "kepler",
  "liora",
  "lumen",
  "luna",
  "lux",
  "naksh",
  "orion",
  "perseus",
  "rigel",
  "sirius",
  "ursa",
  "zagan",
  "zenith",
] as const;

export type XaiBuiltinVoice = (typeof XAI_BUILTIN_VOICES)[number];

export const VOICE_CHOICE_STORAGE_KEY = "amcos.voice.choice.v1";

const ALLOWED = new Set<string>(XAI_BUILTIN_VOICES);

export function isAllowedXaiVoice(value: unknown): value is XaiBuiltinVoice {
  return typeof value === "string" && ALLOWED.has(value);
}

/** Server/client allowlist: unknown or corrupt → default eve. */
export function resolveXaiVoiceId(raw: unknown, fallback: XaiBuiltinVoice = DEFAULT_XAI_VOICE): XaiBuiltinVoice {
  if (isAllowedXaiVoice(raw)) return raw;
  return fallback;
}

export function readStoredVoiceChoice(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined): XaiBuiltinVoice {
  if (!storage) return DEFAULT_XAI_VOICE;
  let raw: string | null = null;
  try {
    raw = storage.getItem(VOICE_CHOICE_STORAGE_KEY);
  } catch {
    return DEFAULT_XAI_VOICE;
  }
  const resolved = resolveXaiVoiceId(raw);
  if (raw !== resolved) {
    try {
      storage.setItem(VOICE_CHOICE_STORAGE_KEY, resolved);
    } catch {
      /* private mode */
    }
  }
  return resolved;
}

export function writeStoredVoiceChoice(
  voice: unknown,
  storage: Pick<Storage, "setItem"> | null | undefined,
): XaiBuiltinVoice {
  const resolved = resolveXaiVoiceId(voice);
  try {
    storage?.setItem(VOICE_CHOICE_STORAGE_KEY, resolved);
  } catch {
    /* private mode */
  }
  return resolved;
}

export function voiceDisplayName(id: XaiBuiltinVoice): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
