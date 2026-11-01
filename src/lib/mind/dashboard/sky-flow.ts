/**
 * Pure sky animation helpers for constellation line flow + landing-trail travel.
 * Zero allocations in the hot path when callers pass reusable out vectors.
 */

/** Phase 0..1 along a flowing dash (health-scaled speed). NaN-safe. */
export function lineFlowPhase(tSeconds: number, speed = 0.35, seed = 0): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const s = Number.isFinite(speed) ? speed : 0.35;
  const ph = Number.isFinite(seed) ? seed : 0;
  const x = t * s + ph;
  return x - Math.floor(x);
}

/** Dash offset for LineDashedMaterial (negative so dashes travel toward B). */
export function lineDashOffset(tSeconds: number, speed = 0.55, seed = 0): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0.55;
  const ph = Number.isFinite(seed) ? seed : 0;
  return -(t * s + ph);
}

export type Xyz = { x: number; y: number; z: number };

/**
 * Sample a traveler on a polyline. progress in [0,1] loops. Writes into `out`.
 * Empty / single-point paths collapse to the first point (or 0,0,0).
 */
export function samplePolylineTravel(
  out: Xyz,
  points: ReadonlyArray<Readonly<Xyz>>,
  progress: number,
): Xyz {
  if (!points.length) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  if (points.length === 1) {
    const p = points[0]!;
    out.x = Number.isFinite(p.x) ? p.x : 0;
    out.y = Number.isFinite(p.y) ? p.y : 0;
    out.z = Number.isFinite(p.z) ? p.z : 0;
    return out;
  }
  let u = Number.isFinite(progress) ? progress : 0;
  u = u - Math.floor(u);
  if (u < 0) u += 1;
  const segCount = points.length - 1;
  const scaled = u * segCount;
  let i = Math.floor(scaled);
  if (i >= segCount) i = segCount - 1;
  const local = scaled - i;
  const a = points[i]!;
  const b = points[i + 1]!;
  const ax = Number.isFinite(a.x) ? a.x : 0;
  const ay = Number.isFinite(a.y) ? a.y : 0;
  const az = Number.isFinite(a.z) ? a.z : 0;
  const bx = Number.isFinite(b.x) ? b.x : ax;
  const by = Number.isFinite(b.y) ? b.y : ay;
  const bz = Number.isFinite(b.z) ? b.z : az;
  out.x = ax + (bx - ax) * local;
  out.y = ay + (by - ay) * local;
  out.z = az + (bz - az) * local;
  return out;
}

/** Looping progress from motion time (seconds). */
export function travelProgress(tSeconds: number, durationSec = 6, seed = 0): number {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 6;
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const ph = Number.isFinite(seed) ? seed : 0;
  const x = (t + ph) / dur;
  return x - Math.floor(x);
}
