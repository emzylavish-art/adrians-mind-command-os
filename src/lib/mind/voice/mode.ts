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
 * mode for React state. Sync write avoids the hydrate/effect race where flipping
 * `hydrated` to true while state is still the SSR default ("direct") clobbers a
 * stored Orchestrator choice — and avoids losing a toggle that happened before
 * the hydrate effect ran (persist-effect skipped while !hydrated).
 */
export function commitVoiceMode(
  next: VoiceRoutingMode,
  storage?: Pick<Storage, "setItem"> | null,
): VoiceRoutingMode {
  writeStoredVoiceMode(next, storage);
  return next;
}

/**
 * Reproduce the real browser failure mode under React effect ordering:
 * 1) SSR/default state is Direct + not hydrated
 * 2) User toggles Orchestrator (must persist immediately)
 * 3) Hydrate effect runs (must read Orchestrator, not overwrite with Direct)
 * 4) Reload / remount reads Orchestrator
 *
 * Also covers the prior bug: marking hydrated while mode is still Direct and
 * then writing from an effect would wipe Orchestrator — commitVoiceMode does
 * not rely on that effect.
 */
export function simulateVoiceModeReloadCycle(storage: VoiceModeStorage): {
  afterToggle: VoiceRoutingMode;
  afterHydrate: VoiceRoutingMode;
  afterReload: VoiceRoutingMode;
  stored: string | null;
} {
  // Fresh page: empty or prior value — start as if first visit then user toggles.
  writeStoredVoiceMode("direct", storage); // clear to known baseline for the sim
  let uiMode: VoiceRoutingMode = "direct";
  let hydrated = false;

  // User clicks Switch before/without waiting for effects (or effect write was gated).
  uiMode = commitVoiceMode(toggleVoiceMode(uiMode), storage);
  const afterToggle = uiMode;

  // Hydrate effect: read storage into state (must not write default).
  uiMode = readStoredVoiceMode(storage);
  hydrated = true;
  void hydrated;
  const afterHydrate = uiMode;

  // Reload: new mount default Direct, then hydrate from storage.
  uiMode = "direct";
  hydrated = false;
  uiMode = readStoredVoiceMode(storage);
  hydrated = true;
  const afterReload = uiMode;

  return {
    afterToggle,
    afterHydrate,
    afterReload,
    stored: storage.getItem(VOICE_MODE_STORAGE_KEY),
  };
}
