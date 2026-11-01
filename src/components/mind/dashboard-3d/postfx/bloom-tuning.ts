import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";

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
};

/** Max bloom buffer edge — UnrealBloomPass allocates 5 mips ×2 targets. */
export const BLOOM_MAX_EDGE = 4096;

/** Clamp a drawing-buffer size so resize to 0×0 / NaN / 8K×DPR can't break bloom. */
export function safeBloomSize(width: number, height: number): [number, number] {
  const clamp = (v: number) =>
    Number.isFinite(v) ? Math.max(1, Math.min(BLOOM_MAX_EDGE, Math.round(v))) : 1;
  return [clamp(width), clamp(height)];
}

export function createTunedBloomPass(
  size: THREE.Vector2,
  tone: HealthTone = "idle",
): TunedBloomHandle {
  const p = BLOOM_BY_TONE[normalizeHealthTone(tone)];
  const [w0, h0] = safeBloomSize(size.x, size.y);
  const pass = new UnrealBloomPass(new THREE.Vector2(w0, h0), p.strength, p.radius, p.threshold);
  let disposed = false;
  // Device-pixel size last applied (composer path or handle path).
  let devW = w0;
  let devH = h0;
  // HACKER (high-DPR): EffectComposer calls pass.setSize(w*dpr, h*dpr) directly —
  // clamp that path too so NaN/0/8K×DPR can't allocate broken mip targets.
  const rawSetSize = pass.setSize.bind(pass);
  pass.setSize = (width: number, height: number) => {
    if (disposed) return;
    const [w, h] = safeBloomSize(width, height);
    devW = w;
    devH = h;
    rawSetSize(w, h);
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
    pass.dispose();
  };
  return { pass, update, setSize, dispose };
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
