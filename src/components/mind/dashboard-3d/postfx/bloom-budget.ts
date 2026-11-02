/**
 * Light #110 — bloom chain resolution budget by drawing-buffer size.
 *
 * UnrealBloomPass allocates a bright target + 5 mips × 2 HalfFloat targets
 * starting at buf/2 per edge. On a retina / 4K buffer (DPR capped at 1.75 →
 * 4480×2520 ≈ 11.3 MP) mip-0 alone is ≈ 2.8 MP and the high-pass + 10 blur
 * passes + composite shade ≈ 3.8 MP of HalfFloat fill every frame.
 *
 * Budget: once the buffer exceeds BLOOM_BUDGET_TRIGGER_PIXELS (= the #109
 * god-ray reference, 2.5 MP) mip-0 is capped at BLOOM_MIP0_CAP_PIXELS
 * (1.25 MP). The #109 frame-time backoff tier (createGodRayBudget) lowers the
 * cap further on a sustained-slow GPU.
 *
 * Footprint compensation: lowering the chain resolution by `s` makes every
 * bloom texel 1/s buffer px wide, so the stock kernels (σ = k/3 texels) would
 * widen every halo by 1/s. The `radius` knob only re-weights the 5 mips and
 * cannot shrink the tightest one, so instead each mip's Gaussian is re-based
 * in texel units such that its screen-space variance (blur + texel prefilter
 * t²/12) equals the native chain's — and its discrete tap sum is renormalised
 * to the stock sum, so energy (≈ strength) is unchanged and radius/strength
 * need no change. `bloomFootprint*` lets tests measure the result from the
 * pass's *actual* uniforms + render-target sizes.
 *
 * Pure / three-free so it runs under node:test.
 */

import { GOD_RAY_REF_PIXELS, GOD_RAY_TAP_TIERS } from "./god-ray-budget.ts";

/** Above this drawing-buffer size the bloom chain is budgeted (shared with #109). */
export const BLOOM_BUDGET_TRIGGER_PIXELS = GOD_RAY_REF_PIXELS;
/** Mip-0 pixel cap at frame tier 0. */
export const BLOOM_MIP0_CAP_PIXELS = 1_250_000;
/** Mip-0 cap per #109 backoff tier (index = createGodRayBudget().backoffTier). */
export const BLOOM_MIP0_TIER_CAPS: readonly number[] = [1_250_000, 1_000_000, 800_000, 640_000, 500_000];
/** Never shrink the chain below this linear scale (aliasing of small sparkles). */
export const BLOOM_MIN_SCALE = 0.35;
/** three r187 UnrealBloomPass kernel radii per mip. */
export const BLOOM_KERNEL_RADII: readonly number[] = [6, 10, 14, 18, 22];
/** three r187 composite bloomFactors per mip. */
export const BLOOM_FACTORS: readonly number[] = [1.0, 0.8, 0.6, 0.4, 0.2];

if (BLOOM_MIP0_TIER_CAPS.length !== GOD_RAY_TAP_TIERS.length) {
  throw new Error("bloom-budget: tier caps must mirror GOD_RAY_TAP_TIERS");
}

const finitePos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Linear scale (≤1) applied to the bloom input size for a buffer + frame tier. */
export function bloomScaleFor(bufW: number, bufH: number, tier: number = 0): number {
  const px = finitePos(bufW) * finitePos(bufH);
  if (px <= BLOOM_BUDGET_TRIGGER_PIXELS) return 1;
  const t = Number.isFinite(tier) ? Math.min(BLOOM_MIP0_TIER_CAPS.length - 1, Math.max(0, Math.round(tier))) : 0;
  const cap = BLOOM_MIP0_TIER_CAPS[t];
  const mip0 = px / 4;
  if (mip0 <= cap) return 1;
  return Math.max(BLOOM_MIN_SCALE, Math.sqrt(cap / mip0));
}

export type BlurKernel = { centerWeight: number; offsets: number[]; weights: number[] };

/** Exactly three r187 `_getSeparableBlurMaterial` coefficients for a σ. */
export function blurKernel(kernelRadius: number, sigma: number = kernelRadius / 3): BlurKernel {
  const c: number[] = [];
  for (let i = 0; i < kernelRadius; i++) c.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i < kernelRadius; i += 2) {
    const wa = c[i];
    const wb = i + 1 < kernelRadius ? c[i + 1] : 0;
    const w = wa + wb;
    offsets.push(w > 0 ? (i * wa + (i + 1) * wb) / w : i);
    weights.push(w);
  }
  return { centerWeight: c[0], offsets, weights };
}

/** Σ of the 1D kernel (center + both sides). */
export function kernelSum(k: BlurKernel): number {
  return k.centerWeight + 2 * k.weights.reduce((a, b) => a + b, 0);
}

/**
 * Exact 1D variance (texels²) of what the shader samples: each merged tap at a
 * fractional offset `o` is a bilinear blend of texels ⌊o⌋, ⌈o⌉.
 */
export function kernelVarianceTexels(k: BlurKernel): number {
  let m2 = 0;
  for (let i = 0; i < k.offsets.length; i++) {
    const o = k.offsets[i];
    const lo = Math.floor(o);
    const f = o - lo;
    m2 += 2 * k.weights[i] * ((1 - f) * lo * lo + f * (lo + 1) * (lo + 1));
  }
  const s = kernelSum(k);
  return s > 0 ? m2 / s : 0;
}

/** Texel prefilter (box of one texel) variance in texels². */
export const TEXEL_PREFILTER_VAR = 1 / 12;

/**
 * Kernel for mip `i` at chain scale `s` whose screen-space variance equals the
 * native (s=1) stock kernel's, renormalised to the stock tap sum.
 */
export function rebasedBlurKernel(kernelRadius: number, scale: number): BlurKernel {
  const stock = blurKernel(kernelRadius);
  if (!(scale > 0) || scale >= 1 - 1e-9) return stock;
  // Native screen var / t² = (kv + 1/12); at scale s texel is 1/s wider.
  const target = (kernelVarianceTexels(stock) + TEXEL_PREFILTER_VAR) * scale * scale - TEXEL_PREFILTER_VAR;
  let lo = 0.05;
  let hi = kernelRadius / 3;
  for (let it = 0; it < 48; it++) {
    const mid = (lo + hi) / 2;
    if (kernelVarianceTexels(blurKernel(kernelRadius, mid)) < target) lo = mid;
    else hi = mid;
  }
  const k = blurKernel(kernelRadius, (lo + hi) / 2);
  const norm = kernelSum(stock) / kernelSum(k);
  return { centerWeight: k.centerWeight * norm, offsets: k.offsets, weights: k.weights.map((w) => w * norm) };
}

// ---------------------------------------------------------------------------
// Footprint model (used by tests to *measure* the configured chain).
// ---------------------------------------------------------------------------

export type BloomMipMeasure = {
  /** Mip render-target width (texels). */
  rtW: number;
  /** Kernel uniforms actually on the blur material. */
  kernel: BlurKernel;
};

export type BloomChainModel = {
  /** Cumulative 1D screen variance (buffer px²) per mip. */
  variances: number[];
  /** 2D energy gain per mip (stock: kernelSum², ≈1). */
  gains: number[];
  /** Composite weight per mip = 3·strength·lerp(f, 1.2−f, radius). */
  weights: number[];
};

/** Build a chain model from measured mip sizes + kernels for a buffer width. */
export function bloomChainModel(
  bufW: number,
  mips: BloomMipMeasure[],
  strength: number,
  radius: number,
): BloomChainModel {
  const variances: number[] = [];
  const gains: number[] = [];
  const weights: number[] = [];
  let v = 0;
  let g = 1;
  mips.forEach((m, i) => {
    const t = bufW / Math.max(1, m.rtW); // buffer px per texel
    v += (kernelVarianceTexels(m.kernel) + TEXEL_PREFILTER_VAR) * t * t;
    const ks = kernelSum(m.kernel);
    g *= ks * ks; // H then V pass
    variances.push(v);
    gains.push(g);
    const f = BLOOM_FACTORS[i] ?? 0;
    weights.push(3 * strength * (f + (1.2 - 2 * f) * radius));
  });
  return { variances, gains, weights };
}

/** erf (Abramowitz–Stegun 7.1.26, |ε| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/** Bloom added at distance `d` (px) from a straight bright edge (chart plate). */
export function edgeGlow(model: BloomChainModel, d: number): number {
  let sum = 0;
  for (let i = 0; i < model.variances.length; i++) {
    sum += model.weights[i] * model.gains[i] * (1 - Phi(d / Math.sqrt(model.variances[i])));
  }
  return sum;
}

/** Bloom at distance `r` (px) from the centre of a bright disc of radius `a` (Imagine node). */
export function discGlow(model: BloomChainModel, a: number, r: number, steps: number = 96): number {
  let sum = 0;
  for (let i = 0; i < model.variances.length; i++) {
    const sd = Math.sqrt(model.variances[i]);
    // ∫_{-a}^{a} N(r−u; σ) · [Φ(√(a²−u²)/σ) − Φ(−√(a²−u²)/σ)] du (midpoint rule)
    let acc = 0;
    const du = (2 * a) / steps;
    for (let k = 0; k < steps; k++) {
      const u = -a + (k + 0.5) * du;
      const half = Math.sqrt(Math.max(0, a * a - u * u));
      const gx = Math.exp(-0.5 * ((r - u) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
      acc += gx * (2 * Phi(half / sd) - 1) * du;
    }
    sum += model.weights[i] * model.gains[i] * acc;
  }
  return sum;
}

/** Outermost distance where glow(d) ≥ level (bisection on a monotone tail). */
export function glowReach(glow: (d: number) => number, level: number, maxD: number): number {
  if (glow(0) < level) return 0;
  let lo = 0;
  let hi = maxD;
  if (glow(hi) >= level) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (glow(mid) >= level) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
