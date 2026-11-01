/**
 * Focus-aware star easing (Cosmos Motion Bot c5).
 *
 * When a star is selected/hovered (`focusId`), its pulse scale eases toward 1.25× and
 * orbit-drift amplitude damps to 0 so click-and-zoom lands on a still target.
 * Pure helpers + a tiny per-star state object — Dashboard Bot wires `focusId`
 * (typically `rig.subjectId` or hover id). Reduced-motion snaps instantly.
 */
import { damp } from "./ease.ts";
import { finiteOr } from "./sanitize.ts";
import type { PulseSample } from "./star-pulse.ts";
import type { Xyz } from "./orbit-drift.ts";

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
  out.glow = finiteOr(out.glow, 2) * (1 + (m - 1) * 0.5);
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
