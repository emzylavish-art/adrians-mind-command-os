import { DEFAULT_VOICE_SETTINGS, saveVoiceSettings, VOICE_SETTINGS_KEY, type VoiceSettings } from "./voice/settings.ts";

export const THEME_KEY = "amcos.theme.v1";
export const FAILOVER_KEY = "amcos.failover.v1";
export const SPEAK_RATE_KEY = "adrian-speak-rate";

export const APPEARANCE_DEFAULTS = {
  theme: "dark",
  failover: "none",
} as const;

export const VOICE_DEFAULTS: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };

type Store = Pick<Storage, "getItem" | "setItem">;

export function resetAppearance(storage: Store | null | undefined): void {
  storage?.setItem(THEME_KEY, APPEARANCE_DEFAULTS.theme);
  storage?.setItem(FAILOVER_KEY, APPEARANCE_DEFAULTS.failover);
}

export function resetVoice(storage: Store | null | undefined): void {
  saveVoiceSettings(storage, VOICE_DEFAULTS);
  storage?.setItem(SPEAK_RATE_KEY, "natural");
}

export function readSection(storage: Pick<Storage, "getItem"> | null | undefined, section: "appearance" | "voice"): string {
  if (section === "appearance") {
    return JSON.stringify({
      theme: storage?.getItem(THEME_KEY) ?? APPEARANCE_DEFAULTS.theme,
      failover: storage?.getItem(FAILOVER_KEY) ?? APPEARANCE_DEFAULTS.failover,
    });
  }
  return storage?.getItem(VOICE_SETTINGS_KEY) ?? JSON.stringify(VOICE_DEFAULTS);
}
