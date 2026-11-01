import * as THREE from "three";

/** Deterministic 0..1 hash (no DOM). */
export function paperHash(n: number, seed = 1): number {
  const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Pure RGBA buffer of paper grain (procedural, no external image). */
export function makePaperGrainRGBA(
  size: number,
  seed = 1,
  strength = 18,
): Uint8ClampedArray {
  const s = Math.max(8, Math.floor(size));
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n = (paperHash(i * 0.17 + x + y * s, seed) - 0.5) * strength;
      const base = 18 + paperHash(i + 3, seed + 2) * 22;
      const v = Math.min(255, Math.max(0, base + n));
      data[i] = v;
      data[i + 1] = v * 0.98;
      data[i + 2] = Math.min(255, v * 1.05 + 4);
      data[i + 3] = 255;
    }
  }
  return data;
}

export type PaperGrainTextureOptions = {
  size?: number;
  seed?: number;
  strength?: number;
};

/** CanvasTexture paper grain for Three.js materials. */
export function createPaperGrainTexture(
  opts: PaperGrainTextureOptions = {},
): THREE.DataTexture {
  const size = opts.size ?? 256;
  const data = makePaperGrainRGBA(size, opts.seed ?? 1, opts.strength ?? 18);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
