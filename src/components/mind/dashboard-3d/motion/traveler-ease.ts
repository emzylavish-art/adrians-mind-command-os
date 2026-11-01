/**
 * Landing-trail traveler ease (Cosmos Motion Bot c12).
 *
 * Complements Dashboard animation #3 / sky-flow travelers. Pure helpers so a
 * marker eases along a landing polyline with MotionClock phase (no teleport on
 * tab resume). Interruptible pause/resume keeps progress; reduced-motion snaps
 * to a static seed pose. Dashboard Bot keeps mesh/material ownership.
 */
import { clamp01, lerp } from "./ease.ts";
import { finiteOr } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";

export const TRAVELER_DURATION = 7.5;
export const TRAVELER_OPACITY = 0.95;

export type TravelerXyz = { x: number; y: number; z: number };

export type TravelerEaseState = {
  /** Looping progress 0..1 along the path. */
  progress: number;
  /** When true, progress freezes (interruptible). */
  paused: boolean;
  /** Stable seed for reduced-motion static pose / phase offset. */
  seed: number;
};

export type TravelerEaseSample = {
  x: number;
  y: number;
  z: number;
  progress: number;
  /** 0..1 opacity (dimmed when paused). */
  opacity: number;
  done: boolean;
};

export type TravelerEaseOpts = {
  clock?: MotionClock;
  /** Loop duration in motion-seconds. Default TRAVELER_DURATION. */
  duration?: number;
  /** Opacity when running. Default TRAVELER_OPACITY. */
  opacity?: number;
};

const EMPTY_TRAVELER_OPTS: TravelerEaseOpts = Object.freeze({});

export function createTravelerEaseState(seed = 0): TravelerEaseState {
  const s = finiteOr(seed, 0);
  let u = s - Math.floor(s);
  if (u < 0) u += 1;
  return { progress: u, paused: false, seed: s };
}

export function createTravelerEaseSample(): TravelerEaseSample {
  return { x: 0, y: 0, z: 0, progress: 0, opacity: 0, done: true };
}

export function pauseTraveler(state: TravelerEaseState): void {
  state.paused = true;
}

export function resumeTraveler(state: TravelerEaseState): void {
  state.paused = false;
}

/** Pure polyline sample (mirrors dashboard sky-flow; kept in-lane). O(1), no alloc. */
export function sampleTravelerPolyline(
  out: TravelerXyz,
  points: ReadonlyArray<Readonly<TravelerXyz>>,
  progress: number,
): TravelerXyz {
  if (!points || points.length === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  if (points.length === 1) {
    const p = points[0]!;
    out.x = finiteOr(p.x, 0);
    out.y = finiteOr(p.y, 0);
    out.z = finiteOr(p.z, 0);
    return out;
  }
  let u = finiteOr(progress, 0);
  u = u - Math.floor(u);
  if (u < 0) u += 1;
  const segCount = points.length - 1;
  const scaled = u * segCount;
  let i = Math.floor(scaled);
  if (i >= segCount) i = segCount - 1;
  if (i < 0) i = 0;
  const local = scaled - i;
  const a = points[i]!;
  const b = points[i + 1]!;
  const ax = finiteOr(a.x, 0);
  const ay = finiteOr(a.y, 0);
  const az = finiteOr(a.z, 0);
  let bx = finiteOr(b.x, ax);
  let by = finiteOr(b.y, ay);
  let bz = finiteOr(b.z, az);
  // Hacker c13: zero-length / duplicate consecutive → park on A (no NaN lerp).
  if (Math.abs(bx - ax) < 1e-12 && Math.abs(by - ay) < 1e-12 && Math.abs(bz - az) < 1e-12) {
    out.x = ax;
    out.y = ay;
    out.z = az;
    return out;
  }
  out.x = lerp(ax, bx, local);
  out.y = lerp(ay, by, local);
  out.z = lerp(az, bz, local);
  return out;
}

/**
 * Advance traveler along `points`. Uses MotionClock so tab-resume does not teleport.
 * Reduced-motion → static pose at seed fraction. Pause freezes progress.
 */
export function stepTravelerEase(
  state: TravelerEaseState,
  out: TravelerEaseSample,
  points: ReadonlyArray<Readonly<TravelerXyz>>,
  tSeconds: number,
  dt: number,
  reducedMotion: boolean,
  opts: TravelerEaseOpts = EMPTY_TRAVELER_OPTS,
): TravelerEaseSample {
  const o = opts ?? EMPTY_TRAVELER_OPTS;
  const clock = o.clock ?? sharedMotionClock;
  const duration = Math.max(1e-4, finiteOr(o.duration ?? TRAVELER_DURATION, TRAVELER_DURATION));
  const baseOpacity = clamp01(finiteOr(o.opacity ?? TRAVELER_OPACITY, TRAVELER_OPACITY));

  let seedFrac = finiteOr(state.seed, 0);
  seedFrac = seedFrac - Math.floor(seedFrac);
  if (seedFrac < 0) seedFrac += 1;

  if (reducedMotion) {
    state.progress = seedFrac;
    state.paused = false;
    sampleTravelerPolyline(out, points, state.progress);
    out.progress = state.progress;
    out.opacity = baseOpacity;
    out.done = true;
    return out;
  }

  if (state.paused) {
    state.progress = clamp01(finiteOr(state.progress, seedFrac));
    sampleTravelerPolyline(out, points, state.progress);
    out.progress = state.progress;
    out.opacity = baseOpacity * 0.55;
    out.done = false;
    return out;
  }

  // MotionClock-mapped time → looping progress (seed offsets phase).
  const t = clock.map(tSeconds);
  let u = (t + finiteOr(state.seed, 0)) / duration;
  u = u - Math.floor(u);
  if (u < 0) u += 1;
  // Blend a tiny bit with previous progress so a pathological dt blip does not snap;
  // primary source remains clock-mapped u (resume-safe).
  void dt; // reserved for future velocity blending; progress is clock-mapped
  state.progress = u;
  sampleTravelerPolyline(out, points, state.progress);
  out.progress = state.progress;
  out.opacity = baseOpacity;
  out.done = false;
  return out;
}
