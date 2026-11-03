import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { normalizeHealthTone, type HealthTone } from "../atmosphere/health-tone.ts";
import { createChainEncoder } from "./bloom-hdr-chain.ts";
import { bloomStrengthMultiplier, type BloomTier } from "./bloom-policy.ts";

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
  /** Resize with a sanitized size (0/NaN/huge → clamped). */
  setSize: (width: number, height: number) => void;
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
  opts: { tier?: BloomTier } = {},
): TunedBloomHandle {
  const tier = opts.tier ?? "full";
  const scale = bloomStrengthMultiplier(tier);
  const p = BLOOM_BY_TONE[normalizeHealthTone(tone)];
  const [w0, h0] = safeBloomSize(size.x, size.y);
  const pass = new UnrealBloomPass(new THREE.Vector2(w0, h0), p.strength * scale, p.radius, p.threshold);
  let disposed = false;
  const encoder = createChainEncoder(pass);
  const baseRender = pass.render.bind(pass);
  pass.render = function encodedRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (disposed || tier === "off") return;
    const bright = (pass as unknown as { renderTargetBright?: { texture?: { type?: number } } }).renderTargetBright;
    const type = bright?.texture?.type;
    try {
      encoder.sync(type === THREE.UnsignedByteType);
    } catch {
      encoder.sync(false);
    }
    return baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  };
  const update = (next: HealthTone) => {
    if (disposed) return;
    const t = BLOOM_BY_TONE[normalizeHealthTone(next)];
    pass.strength = t.strength * scale;
    pass.radius = t.radius;
    pass.threshold = t.threshold;
  };
  const setSize = (width: number, height: number) => {
    if (disposed) return;
    const [w, h] = safeBloomSize(width, height);
    pass.setSize(w, h);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pass.dispose();
  };
  return { pass, update, setSize, dispose };
}
