/**
 * Star pulse health-change crossfade (Cosmos Motion Bot c17).
 *
 * When a star's health flips (healthy↔stalled↔blocked↔idle), ease pulse
 * amplitude/speed toward the new health instead of snapping. MotionClock-
 * phased blend; reduced-motion snaps. Does not alter sampleStarPulse /
 * stepStarFieldBatch / focus-ring APIs — Dashboard samples both and lerps,
 * or uses `sampleStarPulseCrossfaded` as a drop-in.
 */
import { damp, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";
import {
  normalizePulseHealth,
  sampleStarPulse,
  type PulseHealth,
  type PulseSample,
} from "./star-pulse.ts";

/** Seconds-ish blend rate (damp lambda). ~0.35s to settle at 60fps. */
export const HEALTH_XFADE_LAMBDA = 10;

export type HealthPulseCrossfadeState = {
  /** Last committed (displayed) health. */
  from: PulseHealth;
  /** Target health after the latest flip. */
  to: PulseHealth;
  /** 0 = fully `from`, 1 = fully `to`. */
  blend: number;
};

export type HealthPulseCrossfadeOpts = {
  clock?: MotionClock;
  lambda?: number;
};

const EMPTY_XFADE_OPTS: HealthPulseCrossfadeOpts = Object.freeze({});

export function createHealthPulseCrossfadeState(
  initial: PulseHealth | string = "idle",
): HealthPulseCrossfadeState {
  const h = normalizePulseHealth(initial);
  return { from: h, to: h, blend: 1 };
}

/**
 * Retarget on health change. Same health → no-op. New health starts a blend
 * from the currently displayed mix (from←mix, blend←0) so mid-crossfade
 * flips stay continuous.
 */
export function setHealthPulseTarget(
  state: HealthPulseCrossfadeState,
  health: PulseHealth | string | null | undefined,
  reducedMotion: boolean,
): HealthPulseCrossfadeState {
  const next = normalizePulseHealth(health ?? "idle");
  if (next === state.to) return state;
  if (reducedMotion) {
    state.from = next;
    state.to = next;
    state.blend = 1;
    return state;
  }
  // Displayed health at current blend becomes the new `from`.
  const displayed = state.blend >= 0.999 ? state.to : state.from;
  // If mid-blend, keep `from` as the dominant side for continuity when blend < 0.5
  // else promote `to` → `from`.
  state.from = state.blend < 0.5 ? state.from : state.to;
  // Prefer exact displayed when nearly settled.
  if (state.blend >= 0.999) state.from = displayed;
  state.to = next;
  state.blend = 0;
  return state;
}

/** Advance blend toward 1. Reduced-motion snaps to target. */
export function stepHealthPulseCrossfade(
  state: HealthPulseCrossfadeState,
  dt: number,
  reducedMotion: boolean,
  opts: HealthPulseCrossfadeOpts = EMPTY_XFADE_OPTS,
): HealthPulseCrossfadeState {
  const o = opts ?? EMPTY_XFADE_OPTS;
  if (reducedMotion) {
    state.from = state.to;
    state.blend = 1;
    return state;
  }
  const lambda = finiteOr(o.lambda ?? HEALTH_XFADE_LAMBDA, HEALTH_XFADE_LAMBDA);
  const d = sanitizeDt(dt);
  state.blend = damp(finiteOr(state.blend, 1), 1, lambda, d);
  if (state.blend > 0.999) {
    state.blend = 1;
    state.from = state.to;
  }
  return state;
}

/**
 * Sample pulse with health crossfade: evaluates `from` and `to` into temps
 * (caller-provided) and lerps into `out`. Zero alloc when temps reused.
 */
export function sampleStarPulseCrossfaded(
  out: PulseSample,
  fromOut: PulseSample,
  toOut: PulseSample,
  state: HealthPulseCrossfadeState,
  tSeconds: number,
  phase: number,
  reducedMotion: boolean,
  opts: HealthPulseCrossfadeOpts = EMPTY_XFADE_OPTS,
): PulseSample {
  const o = opts ?? EMPTY_XFADE_OPTS;
  const clock = o.clock ?? sharedMotionClock;
  if (reducedMotion || state.blend >= 0.999 || state.from === state.to) {
    return sampleStarPulse(out, tSeconds, phase, state.to, reducedMotion, clock);
  }
  sampleStarPulse(fromOut, tSeconds, phase, state.from, false, clock);
  sampleStarPulse(toOut, tSeconds, phase, state.to, false, clock);
  const b = finiteOr(state.blend, 1);
  out.scale = lerp(fromOut.scale, toOut.scale, b);
  out.glow = lerp(fromOut.glow, toOut.glow, b);
  out.emissive = lerp(fromOut.emissive, toOut.emissive, b);
  return out;
}
