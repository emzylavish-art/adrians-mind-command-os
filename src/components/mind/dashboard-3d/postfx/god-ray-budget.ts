/**
 * Light #109 — god-ray adaptive tap budget by drawing-buffer size.
 *
 * The shaft pass costs ~2 texture reads (colour + depth) × taps × every
 * device pixel. At 48 taps that is fine at 1080p but on a 4K / retina buffer
 * (DPR capped at 1.75 → ~11 MP) it is ~5× the 1080p cost, right when Imagine
 * scenes and node detail need the frame budget.
 *
 * This module is pure (node:test friendly):
 *  - `godRayTapsFor(bufW, bufH)` keeps the per-frame tap×pixel work near the
 *    ~2.5 MP × 48-tap reference by lowering taps above that size (floor 16).
 *  - `godRayTapParams(taps)` keeps the *look* identical across tap counts:
 *    per-tap decay is re-based so the falloff over the full shaft reach is the
 *    same as 48 taps at decay 0.955, and a normalisation factor makes the
 *    accumulated energy for a uniform bright field EXACTLY equal to the legacy
 *    48-tap result — so a budget change never pops shaft brightness, only the
 *    (jittered) sampling density changes. Reach (density, in UV) is unchanged.
 *  - `createGodRayBudget()` adds a frame-time backoff with hysteresis: a slow
 *    EMA (> ~22 ms ≈ <45 fps) held for a while drops one tier, a sustained fast
 *    EMA (< ~17.5 ms) climbs back. Huge deltas (tab hidden, debugger) and junk
 *    are ignored so a background tab never permanently degrades the shafts.
 */

export const GOD_RAY_MAX_TAPS = 48;
export const GOD_RAY_MIN_TAPS = 16;
/** Drawing-buffer pixels at which the full 48 taps are still affordable. */
export const GOD_RAY_REF_PIXELS = 2_500_000;
/** Legacy look: decay per tap at 48 taps. */
export const GOD_RAY_REF_DECAY = 0.955;
/** Tiers the frame-time backoff steps through (descending). */
export const GOD_RAY_TAP_TIERS = [48, 40, 32, 24, 16] as const;

const clampTaps = (n: number) =>
  Math.min(GOD_RAY_MAX_TAPS, Math.max(GOD_RAY_MIN_TAPS, Math.round(n)));

/** Taps for a drawing buffer (device px). Junk / tiny buffers → full 48. */
export function godRayTapsFor(bufW: number, bufH: number): number {
  const w = Number.isFinite(bufW) && bufW > 0 ? bufW : 0;
  const h = Number.isFinite(bufH) && bufH > 0 ? bufH : 0;
  const px = w * h;
  if (px <= GOD_RAY_REF_PIXELS) return GOD_RAY_MAX_TAPS;
  // Work ∝ px × taps → keep it at the reference. Round down to an even count.
  const raw = (GOD_RAY_MAX_TAPS * GOD_RAY_REF_PIXELS) / px;
  return clampTaps(Math.floor(raw / 2) * 2);
}

export type GodRayTapParams = {
  taps: number;
  /** Per-tap decay so decay^taps == REF_DECAY^48 (same falloff over the reach). */
  decay: number;
  /** Multiply the raw accumulation by this (replaces legacy `/ (48 * 0.25)`). */
  norm: number;
};

/** Geometric sum Σ_{i<n} d^i. */
function geomSum(d: number, n: number): number {
  if (Math.abs(1 - d) < 1e-9) return n;
  return (1 - Math.pow(d, n)) / (1 - d);
}

const REF_SUM = geomSum(GOD_RAY_REF_DECAY, GOD_RAY_MAX_TAPS);
const REF_NORM = 1 / (GOD_RAY_MAX_TAPS * 0.25);

export function godRayTapParams(tapsIn: number, refDecay: number = GOD_RAY_REF_DECAY): GodRayTapParams {
  const taps = Number.isFinite(tapsIn) ? clampTaps(tapsIn) : GOD_RAY_MAX_TAPS;
  const d0 = Number.isFinite(refDecay) && refDecay > 0 && refDecay <= 1 ? refDecay : GOD_RAY_REF_DECAY;
  const decay = Math.pow(d0, GOD_RAY_MAX_TAPS / taps);
  const refSum = d0 === GOD_RAY_REF_DECAY ? REF_SUM : geomSum(d0, GOD_RAY_MAX_TAPS);
  // Uniform field energy: Σ d_n^i · norm_n must equal Σ d0^i · REF_NORM.
  const norm = (REF_NORM * refSum) / geomSum(decay, taps);
  return { taps, decay, norm };
}

/** Accumulated energy of a uniform unit field (what the shader would sum). */
export function godRayUniformEnergy(p: GodRayTapParams): number {
  return geomSum(p.decay, p.taps) * p.norm;
}

export type GodRayBudgetOpts = {
  /** EMA above this (ms) counts as slow. */
  slowMs?: number;
  /** EMA below this (ms) counts as fast. */
  fastMs?: number;
  /** Consecutive slow samples before stepping down a tier. */
  slowHold?: number;
  /** Consecutive fast samples before stepping up a tier. */
  fastHold?: number;
  /** Samples above this (ms) are ignored (tab hidden / breakpoints). */
  ignoreAboveMs?: number;
  /** EMA smoothing 0..1 (weight of the new sample). */
  alpha?: number;
};

export type GodRayBudget = {
  /** Feed the live drawing-buffer size (device px). Returns current taps. */
  setBuffer: (bufW: number, bufH: number) => number;
  /** Feed one frame time in ms. Returns current taps. */
  sampleFrame: (ms: number) => number;
  /** Effective taps = min(size cap, backoff tier). */
  readonly taps: number;
  readonly params: GodRayTapParams;
  readonly sizeTaps: number;
  readonly backoffTier: number;
  readonly frameEmaMs: number | null;
  reset: () => void;
};

export function createGodRayBudget(opts: GodRayBudgetOpts = {}): GodRayBudget {
  const slowMs = opts.slowMs ?? 22;
  const fastMs = opts.fastMs ?? 17.5;
  const slowHold = Math.max(1, opts.slowHold ?? 45);
  const fastHold = Math.max(1, opts.fastHold ?? 180);
  const ignoreAbove = opts.ignoreAboveMs ?? 250;
  const alpha = Math.min(1, Math.max(0.01, opts.alpha ?? 0.1));
  let sizeTaps = GOD_RAY_MAX_TAPS;
  let tier = 0; // index into GOD_RAY_TAP_TIERS
  let ema: number | null = null;
  let slowRun = 0;
  let fastRun = 0;
  let params = godRayTapParams(GOD_RAY_MAX_TAPS);
  const effective = () => Math.min(sizeTaps, GOD_RAY_TAP_TIERS[tier]);
  const refresh = () => {
    const t = effective();
    if (t !== params.taps) params = godRayTapParams(t);
    return params.taps;
  };
  return {
    setBuffer(bufW, bufH) {
      sizeTaps = godRayTapsFor(bufW, bufH);
      return refresh();
    },
    sampleFrame(ms) {
      if (!Number.isFinite(ms) || ms <= 0 || ms > ignoreAbove) return params.taps;
      ema = ema === null ? ms : ema + (ms - ema) * alpha;
      if (ema > slowMs) {
        slowRun++;
        fastRun = 0;
        // Only step down if it would actually lower the effective taps.
        if (slowRun >= slowHold) {
          // Jump to the first tier that actually lowers the effective taps.
          const cur = effective();
          let j = tier + 1;
          while (j < GOD_RAY_TAP_TIERS.length && GOD_RAY_TAP_TIERS[j] >= cur) j++;
          if (j < GOD_RAY_TAP_TIERS.length) {
            tier = j;
            slowRun = 0;
          } else {
            slowRun = slowHold; // already at the floor: saturate
          }
        }
      } else if (ema < fastMs) {
        fastRun++;
        slowRun = 0;
        if (fastRun >= fastHold && tier > 0) {
          tier--;
          fastRun = 0;
        } else if (fastRun >= fastHold) {
          fastRun = fastHold;
        }
      } else {
        slowRun = 0;
        fastRun = 0;
      }
      return refresh();
    },
    get taps() {
      return params.taps;
    },
    get params() {
      return params;
    },
    get sizeTaps() {
      return sizeTaps;
    },
    get backoffTier() {
      return tier;
    },
    get frameEmaMs() {
      return ema;
    },
    reset() {
      tier = 0;
      ema = null;
      slowRun = 0;
      fastRun = 0;
      refresh();
    },
  };
}
