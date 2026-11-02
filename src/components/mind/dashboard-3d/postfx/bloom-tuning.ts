import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";
import { BLOOM_KERNEL_RADII, bloomScaleFor, rebasedBlurKernel } from "./bloom-budget.ts";
import { createGodRayBudget, type GodRayBudgetOpts } from "./god-ray-budget.ts";

export type BloomTuning = {
  strength: number;
  radius: number;
  threshold: number;
};

/** Health-aware bloom knobs — blocked blooms harder; idle stays restrained. */
export const BLOOM_BY_TONE: Record<HealthTone, BloomTuning> = {
  healthy: { strength: 0.58, radius: 0.72, threshold: 0.24 },
  stalled: { strength: 0.7, radius: 0.78, threshold: 0.2 },
  blocked: { strength: 0.88, radius: 0.85, threshold: 0.16 },
  idle: { strength: 0.45, radius: 0.65, threshold: 0.28 },
};

export function bloomParamsForTone(tone: HealthTone): BloomTuning {
  return { ...BLOOM_BY_TONE[normalizeHealthTone(tone)] };
}

export type TunedBloomHandle = {
  pass: UnrealBloomPass;
  update: (tone: HealthTone) => void;
  /**
   * Resize with a sanitized size (0/NaN/huge → clamped). Width/height are CSS
   * pixels; pass `pixelRatio` for device pixels. Omitted → reuse the ratio the
   * EffectComposer last sized this pass at (composer.setSize runs first), so a
   * CSS-pixel call never shrinks bloom below the device-pixel frame.
   */
  setSize: (width: number, height: number, pixelRatio?: number) => void;
  /** Frees the bloom mip render targets + materials. */
  dispose: () => void;
  /**
   * #110: feed one frame time (ms). Called automatically from pass.render with
   * the composer deltaTime; exposed for tests / manual drivers. Returns the
   * live chain scale.
   */
  sampleFrame: (ms: number) => number;
  /** #110: live linear scale of the bloom chain vs the drawing buffer (≤1). */
  readonly chainScale: number;
  /** #110: #109 frame-time backoff tier driving the mip-0 cap. */
  readonly frameTier: number;
};

export type TunedBloomOpts = {
  /** #110 resolution budget (default on). */
  budget?: boolean;
  /** Frame-time backoff thresholds (shared shape with god-ray-budget #109). */
  frameOpts?: GodRayBudgetOpts;
};

/** Max bloom buffer edge — UnrealBloomPass allocates 5 mips ×2 targets. */
export const BLOOM_MAX_EDGE = 4096;
/** Junk guard for the un-clamped size the #110 budget reads (2× 8K). */
const RAW_MAX_EDGE = 16384;

/**
 * Clamp a drawing-buffer size so resize to 0×0 / NaN / 8K×DPR can't break bloom.
 *
 * HACKER (light c110): the edges used to be clamped independently, so a
 * 5120×1440 super-ultrawide (DPR 1) or 2560×1440 @ DPR 1.75 (4480 wide) got
 * a 4096-wide but full-height bloom chain → bloom texels non-square → every
 * halo stretched horizontally (1.25× on the G9, 1.09× at 4480) and the god-ray
 * / focus glow no longer matched the node it surrounds. Scale uniformly.
 */
export function safeBloomSize(width: number, height: number): [number, number] {
  const fin = (v: number) => (Number.isFinite(v) && v >= 1 ? v : 1);
  let w = fin(width);
  let h = fin(height);
  const edge = Math.max(w, h);
  if (edge > BLOOM_MAX_EDGE) {
    const k = BLOOM_MAX_EDGE / edge;
    w *= k;
    h *= k;
  }
  const r = (v: number) => Math.max(1, Math.min(BLOOM_MAX_EDGE, Math.round(v)));
  return [r(w), r(h)];
}

/** Stock UnrealBloomPass mip widths/heights for an input size (its rounding). */
export function bloomMipSizes(width: number, height: number, nMips = 5): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let x = Math.round(width / 2);
  let y = Math.round(height / 2);
  for (let i = 0; i < nMips; i++) {
    out.push([x, y]);
    x = Math.round(x / 2);
    y = Math.round(y / 2);
  }
  return out;
}

export function createTunedBloomPass(
  size: THREE.Vector2,
  tone: HealthTone = "idle",
  opts: TunedBloomOpts = {},
): TunedBloomHandle {
  const p = BLOOM_BY_TONE[normalizeHealthTone(tone)];
  const [w0, h0] = safeBloomSize(size.x, size.y);
  const pass = new UnrealBloomPass(new THREE.Vector2(w0, h0), p.strength, p.radius, p.threshold);
  let disposed = false;
  // Device-pixel size last applied (composer path or handle path) — pre-budget.
  let devW = w0;
  let devH = h0;
  // Sanitized but un-clamped device size (≤ RAW_MAX_EDGE) — budget input.
  const rawEdge = (v: number, fallback: number) =>
    Number.isFinite(v) && v >= 1 ? Math.min(RAW_MAX_EDGE, Math.round(v)) : fallback;
  let rawW = rawEdge(size.x, w0);
  let rawH = rawEdge(size.y, h0);
  const budgetOn = opts.budget !== false;
  // #110: reuse the #109 frame-time backoff (same thresholds + hysteresis).
  const frame = createGodRayBudget(opts.frameOpts);
  let tier = 0;
  let scale = 1;
  const rawSetSize = pass.setSize.bind(pass);
  /** Size the chain for (devW, devH) at the live budget + rebase kernels. */
  const applySize = () => {
    // Budget from the true device size (pre edge-clamp) so the 4096 clamp is
    // folded into the same footprint-compensated downscale.
    scale = budgetOn ? bloomScaleFor(rawW, rawH, tier) : 1;
    const [bw, bh] = safeBloomSize(rawW * scale, rawH * scale);
    rawSetSize(bw, bh);
    if (!budgetOn) return; // stock kernels (legacy behaviour)
    // Per-mip actual scale (rounding-aware) vs the native chain → kernel rebase
    // so each halo keeps its native screen-space footprint (see bloom-budget.ts).
    const nat = bloomMipSizes(rawW, rawH, pass.nMips);
    const cur = bloomMipSizes(bw, bh, pass.nMips);
    for (let i = 0; i < pass.nMips; i++) {
      const mat = pass.separableBlurMaterials[i];
      const kr = BLOOM_KERNEL_RADII[i];
      if (!mat || kr === undefined) continue;
      const si = Math.sqrt((cur[i][0] / Math.max(1, nat[i][0])) * (cur[i][1] / Math.max(1, nat[i][1])));
      const k = rebasedBlurKernel(kr, Math.min(1, si));
      const u = mat.uniforms as Record<string, { value: unknown }>;
      if (u.centerWeight) u.centerWeight.value = k.centerWeight;
      if (u.gaussianOffsets) u.gaussianOffsets.value = k.offsets;
      if (u.gaussianWeights) u.gaussianWeights.value = k.weights;
    }
  };
  // HACKER (high-DPR): EffectComposer calls pass.setSize(w*dpr, h*dpr) directly —
  // clamp that path too so NaN/0/8K×DPR can't allocate broken mip targets.
  pass.setSize = (width: number, height: number) => {
    if (disposed) return;
    const [w, h] = safeBloomSize(width, height);
    devW = w;
    devH = h;
    rawW = rawEdge(width, w);
    rawH = rawEdge(height, h);
    applySize();
  };
  if (budgetOn) applySize();
  const sampleFrame = (ms: number) => {
    if (disposed || !budgetOn) return scale;
    frame.setBuffer(rawW, rawH);
    frame.sampleFrame(ms);
    // Tier only matters once the buffer is over the trigger (bloomScaleFor).
    if (frame.backoffTier !== tier) {
      const prevScale = scale;
      tier = frame.backoffTier;
      if (bloomScaleFor(rawW, rawH, tier) !== prevScale) applySize();
    }
    return scale;
  };
  const baseRender = pass.render.bind(pass);
  pass.render = function budgetedRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (disposed) return;
    // EffectComposer passes seconds; junk / huge deltas are ignored by the budget.
    sampleFrame(Number(deltaTime) * 1000);
    return baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  };
  const update = (next: HealthTone) => {
    if (disposed) return;
    const t = BLOOM_BY_TONE[normalizeHealthTone(next)];
    pass.strength = t.strength;
    pass.radius = t.radius;
    pass.threshold = t.threshold;
  };
  const setSize = (width: number, height: number, pixelRatio?: number) => {
    if (disposed) return;
    const ratio =
      pixelRatio !== undefined && Number.isFinite(pixelRatio) && pixelRatio > 0
        ? pixelRatio
        : inferPixelRatio(devW, devH, width, height);
    pass.setSize(width * ratio, height * ratio);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // three r187 UnrealBloomPass.dispose() never frees materialHighPassFilter —
    // one leaked program per context-loss rebuild / unmount. Free it here.
    const hp = pass.materialHighPassFilter;
    pass.dispose();
    hp?.dispose();
  };
  return {
    pass,
    update,
    setSize,
    dispose,
    sampleFrame,
    get chainScale() {
      return scale;
    },
    get frameTier() {
      return tier;
    },
  };
}

/**
 * Ratio between the last device-pixel size and a CSS size when both axes agree
 * (i.e. the composer already sized this pass for the same viewport). Else 1.
 */
export function inferPixelRatio(devW: number, devH: number, cssW: number, cssH: number): number {
  if (![devW, devH, cssW, cssH].every((v) => Number.isFinite(v) && v > 0)) return 1;
  const rx = devW / cssW;
  const ry = devH / cssH;
  if (rx < 1 || rx > 4) return 1;
  return Math.abs(rx - ry) <= 0.02 * rx ? rx : 1;
}
