import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { HealthTone } from "../atmosphere/health-tone.ts";

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
  return { ...BLOOM_BY_TONE[tone] };
}

export type TunedBloomHandle = {
  pass: UnrealBloomPass;
  update: (tone: HealthTone) => void;
};

export function createTunedBloomPass(
  size: THREE.Vector2,
  tone: HealthTone = "idle",
): TunedBloomHandle {
  const p = BLOOM_BY_TONE[tone];
  const pass = new UnrealBloomPass(size.clone(), p.strength, p.radius, p.threshold);
  const update = (next: HealthTone) => {
    const t = BLOOM_BY_TONE[next];
    pass.strength = t.strength;
    pass.radius = t.radius;
    pass.threshold = t.threshold;
  };
  return { pass, update };
}
