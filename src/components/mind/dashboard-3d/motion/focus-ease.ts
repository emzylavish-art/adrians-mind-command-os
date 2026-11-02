/**
 * Focus-aware star easing (Cosmos Motion Bot c5 / still-target helper c25).
 *
 * When a star is selected/hovered (`focusId`), its pulse scale eases toward 1.25× and
 * orbit-drift amplitude damps to 0 so click-and-zoom lands on a still target.
 * Pure helpers + a tiny per-star state object — Dashboard Bot wires `focusId`
 * (typically `rig.subjectId` or hover id). Reduced-motion snaps instantly.
 */
import { damp } from "./ease.ts";
import { finiteOr } from "./sanitize.ts";
import { clampGlowScale, GLOW_BASE, type PulseSample } from "./star-pulse.ts";
import {
  sampleOrbitDrift,
  type OrbitDriftOpts,
  type Xyz,
} from "./orbit-drift.ts";

export const FOCUS_PULSE_SCALE = 1.25;
export const FOCUS_PULSE_LAMBDA = 8;
export const FOCUS_DRIFT_LAMBDA = 10;

/** Per-star multipliers. Dashboard Bot keeps one per bot (Map or parallel array). */
export type FocusEaseState = {
  /** 1 at rest → FOCUS_PULSE_SCALE when focused. */
  pulseMul: number;
  /** 1 = full orbit drift → 0 = pinned to base when focused. */
  driftMul: number;
};

export function createFocusEaseState(): FocusEaseState {
  return { pulseMul: 1, driftMul: 1 };
}

/**
 * True only when both ids are non-empty strings and equal.
 * Unknown / null / empty focusId → false (no star is focused).
 */
export function isFocusedStar(
  starId: string | null | undefined,
  focusId: string | null | undefined,
): boolean {
  if (typeof focusId !== "string" || focusId.length === 0) return false;
  if (typeof starId !== "string" || starId.length === 0) return false;
  return starId === focusId;
}

/** Ease pulse multiplier toward 1.25 when focused, else 1. Reduced-motion snaps. */
export function stepFocusPulseMul(
  current: number,
  focused: boolean,
  dt: number,
  reducedMotion: boolean,
  lambda: number = FOCUS_PULSE_LAMBDA,
): number {
  const target = focused ? FOCUS_PULSE_SCALE : 1;
  const c = finiteOr(current, 1);
  if (reducedMotion) return target;
  return damp(c, target, lambda, dt);
}

/** Ease drift multiplier toward 0 when focused, else 1. Reduced-motion snaps. */
export function stepFocusDriftMul(
  current: number,
  focused: boolean,
  dt: number,
  reducedMotion: boolean,
  lambda: number = FOCUS_DRIFT_LAMBDA,
): number {
  const target = focused ? 0 : 1;
  const c = finiteOr(current, 1);
  if (reducedMotion) return target;
  return damp(c, target, lambda, dt);
}

/**
 * Advance one star's focus ease state for this frame.
 * Focus changing mid-ease simply retargets — damp continues from current values.
 */
export function stepFocusEase(
  state: FocusEaseState,
  starId: string | null | undefined,
  focusId: string | null | undefined,
  dt: number,
  reducedMotion: boolean,
): FocusEaseState {
  const focused = isFocusedStar(starId, focusId);
  state.pulseMul = stepFocusPulseMul(state.pulseMul, focused, dt, reducedMotion);
  state.driftMul = stepFocusDriftMul(state.driftMul, focused, dt, reducedMotion);
  return state;
}

/** Apply pulseMul after sampleStarPulse (scale × mul; glow eases gently with focus). */
export function applyFocusPulse(out: PulseSample, pulseMul: number): PulseSample {
  const m = finiteOr(pulseMul, 1);
  out.scale = finiteOr(out.scale, 1) * m;
  // c32: ease glow gently with focus, then hard-cap for painter additive bloom.
  out.glow = clampGlowScale(finiteOr(out.glow, GLOW_BASE) * (1 + (m - 1) * 0.5));
  return out;
}

/**
 * Blend a drifted position toward its base by driftMul.
 * driftMul 1 = unchanged drift; 0 = pinned at base (still target for click-and-zoom).
 */
export function applyFocusDrift(out: Xyz, base: Readonly<Xyz>, driftMul: number): Xyz {
  const m = finiteOr(driftMul, 1);
  const bx = Number.isFinite(base.x) ? base.x : 0;
  const by = Number.isFinite(base.y) ? base.y : 0;
  const bz = Number.isFinite(base.z) ? base.z : 0;
  const ox = Number.isFinite(out.x) ? out.x : bx;
  const oy = Number.isFinite(out.y) ? out.y : by;
  const oz = Number.isFinite(out.z) ? out.z : bz;
  out.x = bx + (ox - bx) * m;
  out.y = by + (oy - by) * m;
  out.z = bz + (oz - bz) * m;
  return out;
}

/** Reused orbit opts for still-target — zero hot-path alloc (c25). */
const STILL_ORBIT_OPTS: OrbitDriftOpts = {
  radialAmp: 0.35,
  bobAmp: 0.2,
};

export type FocusStillTargetOpts = {
  /** Base orbit radial amp before driftMul scale. Default 0.35 (star-batch). */
  radialAmp?: number;
  /** Base orbit bob amp before driftMul scale. Default 0.2 (star-batch). */
  bobAmp?: number;
  yawSpeed?: number;
  clock?: OrbitDriftOpts["clock"];
};

const EMPTY_STILL_OPTS: FocusStillTargetOpts = Object.freeze({});

/**
 * c25: one-call still-target for a focused star.
 * Steps focus ease → applyFocusPulse → orbit with amps × driftMul (0 when focused).
 * When reduced-motion or driftMul ≈ 0, pins `pos` at `base` (no orbit residual).
 * Mutates `state`, `pulse`, and `pos`. Returns `state`.
 * Call after a fresh pulse sample each frame (applyFocusPulse multiplies in place).
 */
export function stepFocusStillTarget(
  state: FocusEaseState,
  pulse: PulseSample,
  pos: Xyz,
  base: Readonly<Xyz>,
  starId: string | null | undefined,
  focusId: string | null | undefined,
  tSeconds: number,
  phase: number,
  dt: number,
  reducedMotion: boolean,
  opts: FocusStillTargetOpts = EMPTY_STILL_OPTS,
): FocusEaseState {
  const o = opts && typeof opts === "object" ? opts : EMPTY_STILL_OPTS;
  stepFocusEase(state, starId, focusId, dt, reducedMotion);
  applyFocusPulse(pulse, state.pulseMul);
  const drift = finiteOr(state.driftMul, 1);
  const bx = Number.isFinite(base.x) ? base.x : 0;
  const by = Number.isFinite(base.y) ? base.y : 0;
  const bz = Number.isFinite(base.z) ? base.z : 0;
  if (reducedMotion || drift <= 1e-6) {
    pos.x = bx;
    pos.y = by;
    pos.z = bz;
    return state;
  }
  const baseRadial = finiteOr(o.radialAmp ?? 0.35, 0.35);
  const baseBob = finiteOr(o.bobAmp ?? 0.2, 0.2);
  STILL_ORBIT_OPTS.radialAmp = baseRadial * drift;
  STILL_ORBIT_OPTS.bobAmp = baseBob * drift;
  STILL_ORBIT_OPTS.yawSpeed = o.yawSpeed;
  STILL_ORBIT_OPTS.clock = o.clock;
  sampleOrbitDrift(pos, base, tSeconds, phase, false, STILL_ORBIT_OPTS);
  STILL_ORBIT_OPTS.clock = undefined;
  return state;
}

