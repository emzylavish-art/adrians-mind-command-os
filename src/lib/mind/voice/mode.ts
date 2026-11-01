export type VoiceRoutingMode = "direct" | "orchestrator";

export const VOICE_MODE_STORAGE_KEY = "amcos.voice.mode.v1";

export type VoiceModeStorage = Pick<Storage, "getItem" | "setItem">;

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

/**
 * Apply a user-driven mode change: write localStorage FIRST, then return the next
 * mode for React state. Avoids the hydrate/effect race that wiped Orchestrator.
 */
export function commitVoiceMode(
  next: VoiceRoutingMode,
  storage?: Pick<Storage, "setItem"> | null,
): VoiceRoutingMode {
  writeStoredVoiceMode(next, storage);
  return next;
}

/** Old buggy gate — kept for regression tests only. */
export function shouldPersistVoiceMode(hydrated: boolean): boolean {
  return hydrated;
}

export function simulateVoiceModeReloadCycle(storage: VoiceModeStorage): {
  afterToggle: VoiceRoutingMode;
  afterHydrate: VoiceRoutingMode;
  afterReload: VoiceRoutingMode;
  stored: string | null;
} {
  writeStoredVoiceMode("direct", storage);
  let uiMode: VoiceRoutingMode = "direct";

  uiMode = commitVoiceMode(toggleVoiceMode(uiMode), storage);
  const afterToggle = uiMode;

  uiMode = readStoredVoiceMode(storage);
  const afterHydrate = uiMode;

  uiMode = "direct";
  uiMode = readStoredVoiceMode(storage);
  const afterReload = uiMode;

  return {
    afterToggle,
    afterHydrate,
    afterReload,
    stored: storage.getItem(VOICE_MODE_STORAGE_KEY),
  };
}
