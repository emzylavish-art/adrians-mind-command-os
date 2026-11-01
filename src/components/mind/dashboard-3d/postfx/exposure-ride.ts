/**
 * Health-reactive exposure ride (light lane, queue #12).
 *
 * Eases renderer.toneMappingExposure + bloom threshold over ~400ms when the
 * fleet health tone (and optional time-of-day hour) changes. Missing / junk
 * tone → idle (neutral). Under reduced-motion the ride snaps (static) — never
 * animates. Values are clamped so a bad caller can't blow out ACES.
 *
 * Pure math + a tiny handle; Dashboard Bot wires `apply` onto the WebGLRenderer
 * and the tuned bloom pass each frame (see postfx/README.md).
 */
import { BLOOM_BY_TONE } from "./bloom-tuning.ts";
import { normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";

export const EXPOSURE_EASE_MS = 400;
export const EXPOSURE_MIN = 0.6;
export const EXPOSURE_MAX = 1.4;

/** Per-tone ACES exposure targets (idle = current universe default 1.05). */
export const EXPOSURE_BY_TONE: Record<HealthTone, number> = {
  healthy: 1.14,
  stalled: 1.0,
  blocked: 0.86,
  idle: 1.05,
};

export type ExposureRideInputs = {
  tone?: unknown;
  /** Local hour 0..23; omitted → no time-of-day scale (1). */
  hour?: number;
  reducedMotion?: boolean;
};

export type ExposureRideState = {
  exposure: number;
  bloomThreshold: number;
};

export type ExposureRideHandle = {
  readonly exposure: number;
  readonly bloomThreshold: number;
  readonly targetExposure: number;
  readonly targetBloomThreshold: number;
  /** Retarget from tone (+ optional hour). Junk tone → idle. */
  setTarget: (inputs: ExposureRideInputs) => void;
  /** Advance the ease by dtMs; returns the current eased state. */
  tick: (dtMs: number) => ExposureRideState;
  /** Write current values onto a renderer + optional bloom pass. */
  apply: (
    renderer: { toneMappingExposure: number },
    bloom?: { pass: { threshold: number } } | { threshold: number },
  ) => void;
  dispose: () => void;
};

/** Clamp a raw exposure into the safe ACES window. Junk → idle exposure. */
export function clampExposure(value: number): number {
  if (!Number.isFinite(value)) return EXPOSURE_BY_TONE.idle;
  return Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, value));
}

/**
 * Gentle time-of-day scale on top of the health target.
 * Night (0–5) dims slightly; golden hour (6–8, 17–19) lifts; midday flat.
 * Junk hour → 1.
 */
export function timeOfDayExposureScale(hour: number): number {
  if (!Number.isFinite(hour)) return 1;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 0 && h < 6) return 0.92;
  if (h >= 6 && h < 9) return 1.06;
  if (h >= 17 && h < 20) return 1.05;
  if (h >= 20) return 0.95;
  return 1;
}

/** Compose the absolute exposure target from tone + optional hour. */
export function exposureTargetFor(inputs: ExposureRideInputs): number {
  const tone = normalizeHealthTone(inputs.tone);
  const base = EXPOSURE_BY_TONE[tone];
  const scale = inputs.hour === undefined ? 1 : timeOfDayExposureScale(inputs.hour);
  return clampExposure(base * scale);
}

/** Bloom threshold target paired with the tone (from BLOOM_BY_TONE). */
export function bloomThresholdFor(tone: unknown): number {
  return BLOOM_BY_TONE[normalizeHealthTone(tone)].threshold;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smoothstep ease 0..1. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export function createExposureRide(init: ExposureRideInputs = {}): ExposureRideHandle {
  let disposed = false;
  let reduced = !!init.reducedMotion;
  let targetExp = exposureTargetFor(init);
  let targetThr = bloomThresholdFor(init.tone);
  let curExp = targetExp;
  let curThr = targetThr;
  let fromExp = curExp;
  let fromThr = curThr;
  let elapsed = EXPOSURE_EASE_MS; // already at rest

  const retarget = (inputs: ExposureRideInputs) => {
    reduced = !!inputs.reducedMotion;
    const nextExp = exposureTargetFor(inputs);
    const nextThr = bloomThresholdFor(inputs.tone);
    if (reduced) {
      curExp = nextExp;
      curThr = nextThr;
      targetExp = nextExp;
      targetThr = nextThr;
      elapsed = EXPOSURE_EASE_MS;
      return;
    }
    // HACKER: universe-scene retargets every frame. An unchanged target must not
    // restart the ease clock, or the 400 ms ride crawls ~0.5%/frame forever.
    if (nextExp === targetExp && nextThr === targetThr) return;
    fromExp = curExp;
    fromThr = curThr;
    targetExp = nextExp;
    targetThr = nextThr;
    elapsed = 0;
  };

  return {
    get exposure() {
      return curExp;
    },
    get bloomThreshold() {
      return curThr;
    },
    get targetExposure() {
      return targetExp;
    },
    get targetBloomThreshold() {
      return targetThr;
    },
    setTarget(inputs) {
      if (disposed) return;
      retarget(inputs);
    },
    tick(dtMs) {
      if (disposed) return { exposure: curExp, bloomThreshold: curThr };
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced || elapsed >= EXPOSURE_EASE_MS) {
        curExp = targetExp;
        curThr = targetThr;
        return { exposure: curExp, bloomThreshold: curThr };
      }
      elapsed = Math.min(EXPOSURE_EASE_MS, elapsed + dt);
      const t = ease(elapsed / EXPOSURE_EASE_MS);
      curExp = clampExposure(lerp(fromExp, targetExp, t));
      curThr = lerp(fromThr, targetThr, t);
      return { exposure: curExp, bloomThreshold: curThr };
    },
    apply(renderer, bloom) {
      if (disposed) return;
      renderer.toneMappingExposure = curExp;
      if (!bloom) return;
      if ("pass" in bloom && bloom.pass) {
        bloom.pass.threshold = curThr;
      } else if ("threshold" in bloom) {
        (bloom as { threshold: number }).threshold = curThr;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
