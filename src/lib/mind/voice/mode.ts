export type VoiceRoutingMode = "direct" | "orchestrator";

export const VOICE_MODE_STORAGE_KEY = "amcos.voice.mode.v1";

export function parseVoiceMode(raw: string | null | undefined): VoiceRoutingMode {
  return raw === "orchestrator" ? "orchestrator" : "direct";
}

export function voiceModeLabel(mode: VoiceRoutingMode): "Direct" | "Orchestrator" {
  return mode === "orchestrator" ? "Orchestrator" : "Direct";
}

export function readStoredVoiceMode(storage?: Pick<Storage, "getItem"> | null): VoiceRoutingMode {
  try {
    return parseVoiceMode(storage?.getItem(VOICE_MODE_STORAGE_KEY));
  } catch {
    return "direct";
  }
}

export function writeStoredVoiceMode(mode: VoiceRoutingMode, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(VOICE_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

export function toggleVoiceMode(mode: VoiceRoutingMode): VoiceRoutingMode {
  return mode === "direct" ? "orchestrator" : "direct";
}
