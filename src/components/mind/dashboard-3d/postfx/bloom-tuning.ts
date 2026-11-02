import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";
import { BLOOM_KERNEL_RADII, bloomScaleFor, rebasedBlurKernel } from "./bloom-budget.ts";
import { createGodRayBudget, type GodRayBudgetOpts } from "./god-ray-budget.ts";
import { applyPrefilter, prefilterUniformDefaults, PREFILTER_HIGHPASS_FRAGMENT, type PrefilterState } from "./bloom-prefilter.ts";
import { boundFramebufferComplete, godRayMaskType } from "./god-ray-mask.ts";
import { registerVramSource, type VramRendererLike } from "./vram-ledger.ts";
import { createChainEncoder } from "./bloom-hdr-chain.ts";

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
  /** #112: bright-pass prefilter layout used by the last render (n = 1 → stock). */
  readonly prefilter: PrefilterState;
  /**
   * c114 hacker: texel type of the bloom mip chain. Stock UnrealBloomPass always
   * allocates HalfFloat; on WebGL2 without EXT_color_buffer_float/_half_float that
   * FBO is incomplete and bloom silently vanishes, and over the painter c20 byte
   * composer fallback it holds 2× the VRAM for HDR the source doesn't have.
   */
  readonly chainType: THREE.TextureDataType;
  /** c114: true once a HalfFloat chain FBO came back incomplete (sticky byte chain). */
  readonly halfFloatRejected: boolean;
  /**
   * #125: true while the byte chain is gamma-2 Reinhard encoded (every chain
   * write e = sqrt(c/(1+c)), every read decoded before filtering) so > 1
   * survives and dim deep-mip tails don't underflow.
   */
  readonly chainEncoded: boolean;
  /** #125: true once a chain shader hook couldn't be patched (stock byte chain). */
  readonly chainEncodeBroken: boolean;
  /** #120: the chain render targets (VRAM ledger / leak tests). */
  readonly chainTargets: readonly THREE.WebGLRenderTarget[];
};

export type TunedBloomOpts = {
  /** #110 resolution budget (default on). */
  budget?: boolean;
  /** Frame-time backoff thresholds (shared shape with god-ray-budget #109). */
  frameOpts?: GodRayBudgetOpts;
  /** #112 bright-pass anti-alias prefilter (default on with the budget). */
  prefilter?: boolean;
  /**
   * c114: "auto" (default) = chain follows renderable HDR + composer source type;
   * "stock" = always HalfFloat; "byte" (#125 A/B / harness) = always 8-bit.
   */
  chainFormat?: "auto" | "stock" | "byte";
  /** #125: encode a byte chain (default on). false = stock clipping/underflowing A/B. */
  hdrEncode?: boolean;
};

type ChainCaps = {
  capabilities?: { isWebGL2?: boolean };
  extensions?: { has?: (name: string) => boolean };
  setRenderTarget?: (t: THREE.WebGLRenderTarget | null) => void;
  getRenderTarget?: () => THREE.WebGLRenderTarget | null;
};

/**
 * c114: chain texel type for this renderer + composer source, or null when the
 * renderer can't be asked (partial test doubles → keep stock). Same rule as the
 * #117 god-ray mask: HalfFloat only where RGBA16F is renderable AND the source
 * carries HDR; byte composer (painter c20 fallback) → byte chain.
 */
export function bloomChainType(
  renderer: ChainCaps | null | undefined,
  sourceType: THREE.TextureDataType | null | undefined,
): THREE.TextureDataType | null {
  if (!renderer || typeof renderer.extensions?.has !== "function" || !renderer.capabilities) return null;
  return godRayMaskType(renderer, sourceType ?? THREE.HalfFloatType);
}

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
  // #112: swap the stock high-pass fragment for the prefiltered one (same
  // uniforms object, so UnrealBloomPass threshold writes keep working). With
  // taps = 1 it is the stock single tap, so 1080p output is unchanged.
  const prefilterOn = budgetOn && opts.prefilter !== false;
  let prefilter: PrefilterState = { nx: 1, ny: 1, n: 1, spacingX: 0, spacingY: 0 };
  if (prefilterOn && pass.materialHighPassFilter && pass.highPassUniforms) {
    Object.assign(pass.highPassUniforms, prefilterUniformDefaults(THREE.Vector2));
    pass.materialHighPassFilter.uniforms = pass.highPassUniforms as unknown as THREE.ShaderMaterial["uniforms"];
    pass.materialHighPassFilter.fragmentShader = PREFILTER_HIGHPASS_FRAGMENT;
    pass.materialHighPassFilter.needsUpdate = true;
  }
  // c114 hacker: chain format guard (see TunedBloomHandle.chainType).
  const chainTargets = (): THREE.WebGLRenderTarget[] =>
    [pass.renderTargetBright, ...(pass.renderTargetsHorizontal ?? []), ...(pass.renderTargetsVertical ?? [])].filter(
      (t): t is THREE.WebGLRenderTarget => !!t,
    );
  let chainType: THREE.TextureDataType = pass.renderTargetBright?.texture.type ?? THREE.HalfFloatType;
  let halfRejected = false;
  let probedSource: THREE.TextureDataType | null | undefined;
  let probed = false;
  const retype = (type: THREE.TextureDataType) => {
    for (const t of chainTargets()) {
      if (t.texture.type === type) continue;
      t.texture.type = type;
      t.dispose(); // three re-allocates with the new type on next bind
    }
    chainType = type;
  };
  const syncChainType = (renderer: ChainCaps, readBuffer: THREE.WebGLRenderTarget | undefined) => {
    if (opts.chainFormat === "stock") return;
    const src = readBuffer?.texture?.type;
    if (probed && src === probedSource) return;
    let want = opts.chainFormat === "byte" ? THREE.UnsignedByteType : bloomChainType(renderer, src);
    if (want === null) return;
    probed = true;
    probedSource = src;
    if (halfRejected) want = THREE.UnsignedByteType;
    if (want !== chainType) retype(want);
    if (want === THREE.HalfFloatType && pass.renderTargetBright && typeof renderer.setRenderTarget === "function") {
      // Silent-black guard: bind once and ask the driver; incomplete → byte, sticky.
      const prev = typeof renderer.getRenderTarget === "function" ? renderer.getRenderTarget() : null;
      renderer.setRenderTarget(pass.renderTargetBright);
      const ok = boundFramebufferComplete(renderer as unknown as THREE.WebGLRenderer);
      renderer.setRenderTarget(prev);
      if (ok === false) {
        halfRejected = true;
        retype(THREE.UnsignedByteType);
      }
    }
  };
  // #125: HDR-safe byte chain (lazy patch; HalfFloat chains never recompile).
  const encoder = createChainEncoder(pass);
  const hdrEncodeOn = opts.hdrEncode !== false;
  // #120 ledger: chain + the composer buffers this pass actually reads/writes.
  let lastRenderer: VramRendererLike = null;
  let lastRead: THREE.WebGLRenderTarget | null = null;
  let lastWrite: THREE.WebGLRenderTarget | null = null;
  const unregisterChain = registerVramSource("bloom", () =>
    disposed || !lastRenderer ? null : { targets: chainTargets(), renderer: lastRenderer },
  );
  const unregisterComposer = registerVramSource("composer", () =>
    disposed ? null : { targets: [lastRead, lastWrite], renderer: lastRenderer },
  );
  const baseRender = pass.render.bind(pass);
  pass.render = function budgetedRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (disposed) return;
    lastRenderer = renderer as unknown as VramRendererLike;
    lastRead = (readBuffer as THREE.WebGLRenderTarget | undefined) ?? null;
    lastWrite = (writeBuffer as THREE.WebGLRenderTarget | undefined) ?? null;
    try {
      syncChainType(renderer as unknown as ChainCaps, readBuffer as THREE.WebGLRenderTarget | undefined);
    } catch {
      /* caps probe must never break the frame; stock chain stays */
    }
    try {
      // Any byte chain: HDR source clips at 1.0, and (CPU model) even an LDR
      // painter star loses ~62% of its halo to 8-bit underflow in the deep mips.
      encoder.sync(hdrEncodeOn && chainType === THREE.UnsignedByteType && !!readBuffer);
    } catch {
      encoder.sync(false);
    }
    // EffectComposer passes seconds; junk / huge deltas are ignored by the budget.
    sampleFrame(Number(deltaTime) * 1000);
    if (prefilterOn) {
      // Live sizes: readBuffer = drawing buffer, bright = half of mip 0. Writes
      // into whichever high-pass uniforms are active (focus guard swaps its own).
      const bright = pass.renderTargetBright;
      prefilter = applyPrefilter(
        pass.highPassUniforms as unknown as Record<string, { value: unknown }>,
        readBuffer?.width ?? rawW,
        readBuffer?.height ?? rawH,
        bright?.width ?? Math.round(rawW / 2),
        bright?.height ?? Math.round(rawH / 2),
      );
    }
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
    unregisterChain();
    unregisterComposer();
    lastRenderer = lastRead = lastWrite = null;
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
    get prefilter() {
      return prefilter;
    },
    get chainType() {
      return chainType;
    },
    get halfFloatRejected() {
      return halfRejected;
    },
    get chainEncoded() {
      return encoder.encoded;
    },
    get chainEncodeBroken() {
      return encoder.broken;
    },
    get chainTargets() {
      return chainTargets();
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
