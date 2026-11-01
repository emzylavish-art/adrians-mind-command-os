/** Finite-number / dt guards for tab-resume and bad scene data. */

export function finiteOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp animation time; huge tab-hidden jumps collapse to a capped delta carrier. */
export function sanitizeTime(tSeconds: number, fallback = 0): number {
  if (!Number.isFinite(tSeconds)) return fallback;
  // Reject absurd absolute times (clock bugs) — keep phase continuity within a day of seconds
  if (Math.abs(tSeconds) > 86400) return tSeconds % 86400;
  return tSeconds;
}

/** Cap a frame delta (seconds) so resume-from-background cannot explode motion. */
export function sanitizeDt(dtSeconds: number, max = 0.05): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) return 0;
  return dtSeconds > max ? max : dtSeconds;
}

export function finiteXyz(
  x: number,
  y: number,
  z: number,
  fallback: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
