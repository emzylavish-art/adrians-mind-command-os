/**
 * Dashboard-side gate for painter star setColor (c63 / Painter c26).
 * Clamps pulse.emissive so Motion glow pulses cannot wipe watercolor matte,
 * and callers skip setColor when health + clamped emissive are unchanged.
 */

export function clampStarEmissive(emissive: number): number {
  // Match Math.min(1, pulse.emissive) with a floor at 0; NaN → 0 (safe no-op).
  if (typeof emissive !== "number" || Number.isNaN(emissive)) return 0;
  return Math.min(1, Math.max(0, emissive));
}

export type StarSetColorState = {
  health: string;
  emissive: number;
};

/** True when setColor should run (health or clamped emissive changed). */
export function starSetColorNeedsApply(
  prev: StarSetColorState | null | undefined,
  health: string,
  pulseEmissive: number,
): { apply: boolean; emissive: number; next: StarSetColorState } {
  const emissive = clampStarEmissive(pulseEmissive);
  const next = { health, emissive };
  if (!prev || prev.health !== health || prev.emissive !== emissive) {
    return { apply: true, emissive, next };
  }
  return { apply: false, emissive, next };
}
