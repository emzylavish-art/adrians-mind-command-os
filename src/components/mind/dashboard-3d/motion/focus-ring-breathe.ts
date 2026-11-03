/**
 * Focus-ring breathe for selected star (Cosmos Motion Bot c15).
 *
 * Soft opacity/scale breathe on the selection ring, phase-locked to MotionClock
 * (not raw wall — survives tab freeze/resume). Eases in on select / out on
 * deselect. Reduced-motion → static ring at rest opacity (no breathe).
 * Pure helpers — Dashboard Bot owns the ring mesh/HUD.
 */
import { clamp01, damp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";

export const FOCUS_RING_BREATHE_HZ = 0.55;
export const FOCUS_RING_BREATHE_AMP = 0.12;
export const FOCUS_RING_BASE_OPACITY = 0.72;
export const FOCUS_RING_ENTER_LAMBDA = 8;
export const FOCUS_RING_EXIT_LAMBDA = 10;
export const FOCUS_RING_SCALE_BASE = 1;
export const FOCUS_RING_SCALE_AMP = 0.04;

export type FocusRingBreatheState = {
  /** 0 = hidden, 1 = fully present (presence ease). */
  amount: number;
  target: number;
};

export type FocusRingBreatheSample = {
  opacity: number;
  scale: number;
  amount: number;
  /** Breathe wave 0..1 (0.5 rest). */
  breathe: number;
  done: boolean;
};

export type FocusRingBreatheOpts = {
  clock?: MotionClock;
  hz?: number;
  amp?: number;
  baseOpacity?: number;
  enterLambda?: number;
  exitLambda?: number;
  scaleBase?: number;
  scaleAmp?: number;
  /** Stable phase offset (radians). Default 0. */
  phase?: number;
};

const EMPTY_RING_OPTS: FocusRingBreatheOpts = Object.freeze({});

export function createFocusRingBreatheState(): FocusRingBreatheState {
  return { amount: 0, target: 0 };
}

export function createFocusRingBreatheSample(): FocusRingBreatheSample {
  return { opacity: 0, scale: FOCUS_RING_SCALE_BASE, amount: 0, breathe: 0.5, done: true };
}

/** Select / deselect the focus ring. Interruptible mid-ease. */
export function setFocusRingActive(state: FocusRingBreatheState, active: boolean): void {
  state.target = active ? 1 : 0;
}

export function stepFocusRingBreathe(
  state: FocusRingBreatheState,
  out: FocusRingBreatheSample,
  tSeconds: number,
  dt: number,
  reducedMotion: boolean,
  opts: FocusRingBreatheOpts = EMPTY_RING_OPTS,
): FocusRingBreatheSample {
  const o = opts ?? EMPTY_RING_OPTS;
  const clock = o.clock ?? sharedMotionClock;
  const hz = Math.max(0, finiteOr(o.hz ?? FOCUS_RING_BREATHE_HZ, FOCUS_RING_BREATHE_HZ));
  const amp = Math.max(0, finiteOr(o.amp ?? FOCUS_RING_BREATHE_AMP, FOCUS_RING_BREATHE_AMP));
  const base = clamp01(finiteOr(o.baseOpacity ?? FOCUS_RING_BASE_OPACITY, FOCUS_RING_BASE_OPACITY));
  const enterL = Math.max(0, finiteOr(o.enterLambda ?? FOCUS_RING_ENTER_LAMBDA, FOCUS_RING_ENTER_LAMBDA));
  const exitL = Math.max(0, finiteOr(o.exitLambda ?? FOCUS_RING_EXIT_LAMBDA, FOCUS_RING_EXIT_LAMBDA));
  const scaleBase = finiteOr(o.scaleBase ?? FOCUS_RING_SCALE_BASE, FOCUS_RING_SCALE_BASE);
  const scaleAmp = Math.max(0, finiteOr(o.scaleAmp ?? FOCUS_RING_SCALE_AMP, FOCUS_RING_SCALE_AMP));
  const phase = finiteOr(o.phase ?? 0, 0);
  const d = sanitizeDt(dt);
  const target = state.target >= 0.5 ? 1 : 0;

  if (reducedMotion) {
    state.amount = target;
    out.amount = target;
    out.breathe = 0.5;
    out.opacity = target * base;
    out.scale = scaleBase;
    out.done = true;
    return out;
  }

  const lambda = target > state.amount ? enterL : exitL;
  state.amount = damp(finiteOr(state.amount, 0), target, lambda, d);
  if (Math.abs(state.amount - target) < 1e-4) state.amount = target;

  const t = clock.map(tSeconds);
  const wave = hz <= 0 ? 0 : Math.sin(t * hz * Math.PI * 2 + phase);
  const breathe = 0.5 + 0.5 * wave; // 0..1
  const presence = clamp01(state.amount);
  out.amount = presence;
  out.breathe = breathe;
  out.opacity = clamp01(presence * (base + wave * amp));
  out.scale = scaleBase + wave * scaleAmp * presence;
  out.done = (target === 1 && presence >= 1 - 1e-4) || (target === 0 && presence <= 1e-4);
  return out;
}
