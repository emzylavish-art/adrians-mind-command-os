import * as THREE from "three";
import { LorePlaqueShader } from "../shaders/lore-plaque.ts";
import {
  sanitizeFinite,
  sanitizeShaderTime,
  sanitizePaperGrainSize,
  clampTextureSizeToGpu,
  paperHash,
} from "./paper-grain.ts";

export type LorePlaqueOptions = {
  base?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  paper?: number;
  wash?: number;
};

function cloneUniforms(src: typeof LorePlaqueShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uInk: { value: new THREE.Color(src.uInk.value[0], src.uInk.value[1], src.uInk.value[2]) },
    uAccent: { value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]) },
    uTime: { value: 0 },
    uPaper: { value: src.uPaper.value },
    uWash: { value: src.uWash.value },
  };
}

/** Watercolor parchment plaque ShaderMaterial (constellation lore). */
export function createLorePlaqueMaterial(opts: LorePlaqueOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(LorePlaqueShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.ink != null) uniforms.uInk.value.set(opts.ink);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.paper != null) uniforms.uPaper.value = sanitizeFinite(opts.paper, 0.22, 0, 1);
  if (opts.wash != null) uniforms.uWash.value = sanitizeFinite(opts.wash, 0.45, 0, 1);
  return new THREE.ShaderMaterial({
    name: "LorePlaqueMaterial",
    uniforms,
    vertexShader: LorePlaqueShader.vertexShader,
    fragmentShader: LorePlaqueShader.fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function tickLorePlaqueMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

/**
 * Procedural parchment RGBA (no external image) — warmer fiber than paperGrain.
 */
export function makeParchmentRGBA(size: number, seed = 11): Uint8ClampedArray {
  const s = sanitizePaperGrainSize(size, 256);
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n = (paperHash(i * 0.13 + x * 1.7 + y * s, seed) - 0.5) * 22;
      const fiber = paperHash(x * 0.05 + y * 3.1, seed + 4) * 28;
      data[i] = Math.min(255, Math.max(0, 42 + n + fiber * 0.35));
      data[i + 1] = Math.min(255, Math.max(0, 38 + n * 0.9 + fiber * 0.25));
      data[i + 2] = Math.min(255, Math.max(0, 28 + n * 0.7));
      data[i + 3] = 255;
    }
  }
  return data;
}

export function createParchmentTexture(size = 256, seed = 11, maxTextureSize?: number): THREE.DataTexture {
  const s = clampTextureSizeToGpu(size, maxTextureSize);
  const data = makeParchmentRGBA(s, seed);
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Caps for attacker-sized lock-note dumps into plaque content helpers. */
export const LORE_MAX_NOTES = 8;
export const LORE_MAX_CHARS_PER_NOTE = 160;

export type LoreNote = { text: string; truncated: boolean };

/**
 * Sanitize huge/odd lock-note arrays for plaque body text.
 * Rejects non-strings, strips controls, caps count + length — never silent-drop
 * without marking truncation.
 */
export function sanitizeLoreNotes(
  notes: unknown,
  maxNotes = LORE_MAX_NOTES,
  maxChars = LORE_MAX_CHARS_PER_NOTE,
): { notes: LoreNote[]; truncatedCount: number; inputCount: number } {
  const capN = Math.max(1, Math.min(32, Number.isFinite(maxNotes) ? Math.floor(maxNotes as number) : LORE_MAX_NOTES));
  const capC = Math.max(8, Math.min(512, Number.isFinite(maxChars) ? Math.floor(maxChars as number) : LORE_MAX_CHARS_PER_NOTE));
  const arr = Array.isArray(notes) ? notes : [];
  const out: LoreNote[] = [];
  let truncatedCount = 0;
  for (const raw of arr) {
    if (out.length >= capN) {
      truncatedCount += 1;
      continue;
    }
    let s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) continue;
    let truncated = false;
    if (s.length > capC) {
      s = s.slice(0, capC - 1) + "…";
      truncated = true;
      truncatedCount += 1;
    }
    out.push({ text: s, truncated });
  }
  return { notes: out, truncatedCount, inputCount: arr.length };
}

export function createParchmentTextureForGpu(
  size = 256,
  seed = 11,
  maxTextureSize?: number,
): THREE.DataTexture {
  const s = clampTextureSizeToGpu(size, maxTextureSize);
  const data = makeParchmentRGBA(s, seed);
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
