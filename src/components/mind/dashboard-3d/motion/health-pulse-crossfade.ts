/**
 * Star pulse health-change crossfade (Cosmos Motion Bot c17).
 *
 * When a star's health flips (healthy↔stalled↔blocked↔idle), ease pulse
 * amplitude/speed toward the new health instead of snapping. MotionClock-
 * phased blend; reduced-motion snaps. Does not alter sampleStarPulse /
 * stepStarFieldBatch / focus-ring APIs — Dashboard samples both and lerps,
 * or uses `sampleStarPulseCrossfaded` as a drop-in.
 *
 * Hacker c19: status-poll health *flapping* (A→B→A, A→B→C faster than the
 * ~0.35s settle) used to pop the pulse by up to ~10% scale on every retarget,
 * because blend reset to 0 while one side was dropped. State now carries a
 * per-health weight vector (4 healths); retarget only moves the target, so the
 * displayed mix is exactly continuous. `from`/`to`/`blend` stay as derived,
 * backwards-compatible fields; legacy/corrupted literals are rebuilt from them.
 */
import { clamp01, damp } from "./ease.ts";
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
  /** Heaviest non-target health still visible (=== to when settled). */
  from: PulseHealth;
  /** Target health after the latest flip. */
  to: PulseHealth;
  /** Weight of `to` in the displayed mix: 0 = none, 1 = settled. */
  blend: number;
  /**
   * c19: per-health weights in XFADE_HEALTHS order (sum 1). Optional so legacy
   * `{from,to,blend}` literals still work (rebuilt on first use).
   */
  weights?: number[];
};

export type HealthPulseCrossfadeOpts = {
  clock?: MotionClock;
  lambda?: number;
};

const EMPTY_XFADE_OPTS: HealthPulseCrossfadeOpts = Object.freeze({});

/** Weight-vector order. */
export const XFADE_HEALTHS: readonly PulseHealth[] = Object.freeze([
  "healthy",
  "stalled",
  "blocked",
  "idle",
]);

const W_EPS = 1e-6;

function hIndex(h: PulseHealth): number {
  switch (h) {
    case "healthy":
      return 0;
    case "stalled":
      return 1;
    case "blocked":
      return 2;
    default:
      return 3;
  }
}

function rebuildWeights(state: HealthPulseCrossfadeState, w: number[]): void {
  const b = clamp01(finiteOr(state.blend, 1));
  for (let i = 0; i < 4; i++) w[i] = 0;
  w[hIndex(state.to)] += b;
  w[hIndex(state.from)] += 1 - b;
}

/** Recompute derived from/blend from weights (no alloc). */
function deriveFields(state: HealthPulseCrossfadeState, w: number[]): void {
  const ti = hIndex(state.to);
  state.blend = w[ti];
  let best = -1;
  let bestW = W_EPS;
  for (let i = 0; i < 4; i++) {
    if (i === ti) continue;
    if (w[i] > bestW) {
      bestW = w[i];
      best = i;
    }
  }
  state.from = best < 0 ? state.to : XFADE_HEALTHS[best];
}

/**
 * Validate / repair the weight vector. Rebuilds from {from,to,blend} when the
 * vector is missing, non-finite, unnormalized, or out of sync with an externally
 * written `blend` (e.g. pose restore / JSON). Zero-alloc when healthy.
 */
function ensureWeights(state: HealthPulseCrossfadeState): number[] {
  state.to = normalizePulseHealth(state.to);
  state.from = normalizePulseHealth(state.from);
  let w = state.weights;
  let ok = Array.isArray(w) && w.length === 4;
  if (ok) {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const v = w![i];
      if (!Number.isFinite(v) || v < -W_EPS || v > 1 + W_EPS) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok && Math.abs(sum - 1) > 1e-4) ok = false;
    if (ok && !(Math.abs(w![hIndex(state.to)] - state.blend) <= 1e-9)) ok = false;
  }
  if (!ok) {
    if (!Array.isArray(w) || w.length !== 4) {
      w = [0, 0, 0, 0];
      state.weights = w;
    }
    rebuildWeights(state, w!);
    deriveFields(state, w!);
  }
  return w!;
}

function snapTo(state: HealthPulseCrossfadeState, w: number[], h: PulseHealth): void {
  for (let i = 0; i < 4; i++) w[i] = 0;
  w[hIndex(h)] = 1;
  state.to = h;
  state.from = h;
  state.blend = 1;
}

export function createHealthPulseCrossfadeState(
  initial: PulseHealth | string = "idle",
): HealthPulseCrossfadeState {
  const h = normalizePulseHealth(initial);
  const weights = [0, 0, 0, 0];
  weights[hIndex(h)] = 1;
  return { from: h, to: h, blend: 1, weights };
}

/**
 * Retarget on health change. Same health → no-op. The displayed mix is left
 * untouched (exactly continuous); only the target moves, so `blend` becomes the
 * new target's current weight (0 if it was not visible).
 */
export function setHealthPulseTarget(
  state: HealthPulseCrossfadeState,
  health: PulseHealth | string | null | undefined,
  reducedMotion: boolean,
): HealthPulseCrossfadeState {
  const w = ensureWeights(state);
  const next = normalizePulseHealth(health ?? "idle");
  if (reducedMotion) {
    snapTo(state, w, next);
    return state;
  }
  if (next === state.to) return state;
  state.to = next;
  deriveFields(state, w);
  return state;
}

/** Advance target weight toward 1, scaling the others down. Reduced-motion snaps. */
export function stepHealthPulseCrossfade(
  state: HealthPulseCrossfadeState,
  dt: number,
  reducedMotion: boolean,
  opts: HealthPulseCrossfadeOpts = EMPTY_XFADE_OPTS,
): HealthPulseCrossfadeState {
  const o = opts ?? EMPTY_XFADE_OPTS;
  const w = ensureWeights(state);
  if (reducedMotion) {
    snapTo(state, w, state.to);
    return state;
  }
  const lambda = finiteOr(o.lambda ?? HEALTH_XFADE_LAMBDA, HEALTH_XFADE_LAMBDA);
  const d = sanitizeDt(dt);
  const ti = hIndex(state.to);
  const cur = w[ti];
  const next = damp(cur, 1, lambda, d);
  if (next > 0.999) {
    snapTo(state, w, state.to);
    return state;
  }
  const rest = 1 - cur;
  const scale = rest > W_EPS ? (1 - next) / rest : 0;
  for (let i = 0; i < 4; i++) {
    if (i === ti) continue;
    const v = w[i] * scale;
    w[i] = v < W_EPS ? 0 : v;
  }
  w[ti] = next;
  // Renormalize after epsilon pruning so the sum stays exactly 1.
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += w[i];
  if (sum > 0 && Math.abs(sum - 1) > 1e-12) for (let i = 0; i < 4; i++) w[i] /= sum;
  deriveFields(state, w);
  return state;
}

/**
 * Sample pulse with health crossfade: weighted sum over every visible health.
 * `fromOut` is used as scratch; `toOut` receives the pure target sample.
 * Zero alloc when temps are reused.
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
  const w = ensureWeights(state);
  if (reducedMotion || state.blend >= 0.999) {
    return sampleStarPulse(out, tSeconds, phase, state.to, reducedMotion, clock);
  }
  sampleStarPulse(toOut, tSeconds, phase, state.to, false, clock);
  const tw = w[hIndex(state.to)];
  let scale = toOut.scale * tw;
  let glow = toOut.glow * tw;
  let emissive = toOut.emissive * tw;
  const ti = hIndex(state.to);
  for (let i = 0; i < 4; i++) {
    if (i === ti) continue;
    const wi = w[i];
    if (wi <= 0) continue;
    sampleStarPulse(fromOut, tSeconds, phase, XFADE_HEALTHS[i], false, clock);
    scale += fromOut.scale * wi;
    glow += fromOut.glow * wi;
    emissive += fromOut.emissive * wi;
  }
  out.scale = finiteOr(scale, toOut.scale);
  out.glow = finiteOr(glow, toOut.glow);
  out.emissive = finiteOr(emissive, toOut.emissive);
  return out;
}
