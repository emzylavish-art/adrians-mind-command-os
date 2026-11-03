/** Honest screen-share audio policy for live voice (mix + fallbacks). */

export const SCREEN_AUDIO_MIX_STORAGE_KEY = "amcos.voice.screenAudioMix";

export type ScreenAudioStatus =
  | { ok: true; hasAudio: boolean; mixing: boolean; notice: string | null }
  | { ok: false; error: string };

export type ScreenAudioMixPreference = {
  /** When true and display audio exists, mix into the realtime mic graph. */
  mixEnabled: boolean;
};

/** Read the owner's mix toggle (default: on). */
export function readScreenAudioMixEnabled(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): boolean {
  if (!storage) return true;
  const raw = storage.getItem(SCREEN_AUDIO_MIX_STORAGE_KEY);
  if (raw == null) return true;
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function writeScreenAudioMixEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): void {
  storage?.setItem(SCREEN_AUDIO_MIX_STORAGE_KEY, enabled ? "1" : "0");
}

/**
 * After getDisplayMedia resolves, describe audio availability and whether
 * display sound is actually mixed into the realtime input.
 */
export function describeScreenAudio(
  stream: { getAudioTracks: () => unknown[] },
  opts: { mixEnabled?: boolean } = {},
): ScreenAudioStatus {
  const hasAudio = stream.getAudioTracks().length > 0;
  const mixEnabled = opts.mixEnabled ?? true;
  if (!hasAudio) {
    return {
      ok: true,
      hasAudio: false,
      mixing: false,
      notice: "Screen audio is not available — sharing video only (no tab/system sound).",
    };
  }
  if (!mixEnabled) {
    return {
      ok: true,
      hasAudio: true,
      mixing: false,
      notice:
        "Screen audio is available but mix is off — only your mic goes into the call. Turn on “Mix screen audio” in voice settings to include tab/system sound.",
    };
  }
  return {
    ok: true,
    hasAudio: true,
    mixing: true,
    notice: "Screen audio is mixed into the call with your mic (WebAudio).",
  };
}

export function screenShareUnavailableMessage(): string {
  return "Screen share was cancelled or isn't available.";
}

/** Honest note when the browser rejects audio:true on getDisplayMedia. */
export function screenAudioFallbackVideoOnlyMessage(): string {
  return "Screen audio is not available in this browser — sharing video only.";
}
