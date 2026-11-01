/**
 * Cross-control mic occupancy so live voice and overlay/PTT never open two mics.
 */

let liveActive = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function isLiveVoiceOccupied(): boolean {
  return liveActive;
}

export function setLiveVoiceOccupied(next: boolean): void {
  if (liveActive === next) return;
  liveActive = next;
  emit();
}

export function subscribeLiveVoiceOccupied(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Overlay/PTT should call this before opening a mic. */
export const LIVE_VOICE_BUSY_MESSAGE =
  "Live voice is already on. End live voice first, or press Esc.";

export const OVERLAY_MIC_BUSY_MESSAGE =
  "The overlay mic is open. Stop it before starting live voice.";
