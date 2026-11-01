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
/** Opacity multiplier while paused. */
export const TRAVELER_PAUSED_DIM = 0.55;
/** Dim ease time constant (motion-seconds). */
export const TRAVELER_DIM_TAU = 0.18;
const MAX_DIM_STEP_S = 0.1;

export type TravelerXyz = { x: number; y: number; z: number };

export type TravelerEaseState = {
  /** Looping progress 0..1 along the path. */
  progress: number;
  /** When true, progress freezes (interruptible). */
  paused: boolean;
  /** Stable seed for reduced-motion static pose / phase offset. */
  seed: number;
  /**
   * Hacker c21: motion-seconds re-anchor applied after a hold (pause / reduced-motion) so
   * resume continues from the frozen progress instead of snapping to the clock phase.
   * Optional so hand-built states stay valid; kept folded into [0, duration).
   */
  phaseOffset?: number;
  /** True while progress is held (paused or reduced-motion); next free step re-anchors. */
  held?: boolean;
  /** 0 = full opacity, 1 = paused dim. Eased so focus churn does not pop. */
  dim?: number;
  /** Motion time of the last step (for the dim ease; clock-mapped, resume-safe). */
  lastT?: number;
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
  return { progress: u, paused: false, seed: s, phaseOffset: 0, held: false, dim: 0, lastT: Number.NaN };
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

  // Clock is mapped every step (also while held) so the anchor stays live and every
  // sampler fed the same `t` stays phase-locked.
  const t = clock.map(tSeconds);
  const lastT = state.lastT;
  let dtm = typeof lastT === "number" && Number.isFinite(lastT) ? t - lastT : 0;
  if (!(dtm > 0)) dtm = 0;
  else if (dtm > MAX_DIM_STEP_S) dtm = MAX_DIM_STEP_S;
  state.lastT = t;

  let prog = finiteOr(state.progress, seedFrac);
  prog = prog - Math.floor(prog);
  if (!(prog >= 0 && prog < 1)) prog = seedFrac;

  if (reducedMotion) {
    // Hacker c21: do not clear `paused` (silent resume); hold so leaving reduced-motion
    // re-anchors from the static pose instead of snapping to clock phase.
    state.progress = seedFrac;
    state.held = true;
    state.dim = 0;
    sampleTravelerPolyline(out, points, state.progress);
    out.progress = state.progress;
    out.opacity = baseOpacity;
    out.done = true;
    return out;
  }

  // Eased paused dim (no 1-frame opacity pop under focus churn).
  const target = state.paused ? 1 : 0;
  let dim = clamp01(finiteOr(state.dim ?? 0, 0));
  if (dtm > 0) dim += (target - dim) * (1 - Math.exp(-dtm / TRAVELER_DIM_TAU));
  state.dim = dim;
  const opacity = baseOpacity * (1 - (1 - TRAVELER_PAUSED_DIM) * dim);

  if (state.paused) {
    state.progress = prog;
    state.held = true;
    sampleTravelerPolyline(out, points, state.progress);
    out.progress = state.progress;
    out.opacity = opacity;
    out.done = false;
    return out;
  }

  const seed = finiteOr(state.seed, 0);
  let offset = finiteOr(state.phaseOffset ?? 0, 0);
  if (state.held) {
    // Re-anchor: choose offset so this frame lands exactly on the held progress.
    offset = prog * duration - t - seed;
    state.held = false;
  }
  // Fold offset into [0, duration) so it never grows without bound.
  offset = offset - Math.floor(offset / duration) * duration;
  if (!Number.isFinite(offset)) offset = 0;
  state.phaseOffset = offset;

  // MotionClock-mapped time → looping progress (seed + re-anchor offset the phase).
  let u = (t + seed + offset) / duration;
  u = u - Math.floor(u);
  if (!(u >= 0 && u < 1)) u = seedFrac;
  void dt; // progress is clock-mapped; caller dt is untrusted
  state.progress = u;
  sampleTravelerPolyline(out, points, state.progress);
  out.progress = state.progress;
  out.opacity = opacity;
  out.done = false;
  return out;
}
