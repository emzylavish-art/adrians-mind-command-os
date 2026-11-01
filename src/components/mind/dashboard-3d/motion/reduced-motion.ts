/** prefers-reduced-motion helpers for the cosmos motion lane. */

export function prefersReducedMotion(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia,
): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return Boolean(matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

/** Effective motion scale: 0 when reduced, else 1 (or caller override). */
export function motionScale(reducedMotion: boolean, override?: number): number {
  if (reducedMotion) return 0;
  if (override == null) return 1;
  return override < 0 ? 0 : override > 1 ? 1 : override;
}
