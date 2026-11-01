import * as THREE from "three";
import { ImagineNodeShader } from "../shaders/imagine-node.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";

export type ImagineNodeOptions = {
  /** Imagine-generated Texture (portrait/character/scene). Null/undefined → wash fallback. */
  map?: THREE.Texture | null;
  /** Shared paper-grain DataTexture from the painter kit (optional). */
  paperMap?: THREE.Texture | null;
  accent?: THREE.ColorRepresentation;
  wash?: THREE.ColorRepresentation;
  grain?: number;
  bleed?: number;
  frame?: number;
  opacity?: number;
};

function cloneUniforms(src: typeof ImagineNodeShader.uniforms) {
  return {
    uImage: { value: null as THREE.Texture | null },
    uPaperMap: { value: null as THREE.Texture | null },
    uHasImage: { value: 0 },
    uHasPaper: { value: 0 },
    uAccent: {
      value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]),
    },
    uWash: {
      value: new THREE.Color(src.uWash.value[0], src.uWash.value[1], src.uWash.value[2]),
    },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value },
    uBleed: { value: src.uBleed.value },
    uFrame: { value: src.uFrame.value },
    uOpacity: { value: src.uOpacity.value },
  };
}

/**
 * Painterly ShaderMaterial for Imagine people/characters/scenes on universe nodes.
 * Safe when the image is missing or still loading (procedural wash). Does NOT
 * dispose the caller's image Texture — only the material itself.
 */
export function createImagineNodeMaterial(opts: ImagineNodeOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(ImagineNodeShader.uniforms);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.wash != null) uniforms.uWash.value.set(opts.wash);
  if (opts.grain != null) uniforms.uGrain.value = sanitizeFinite(opts.grain, 0.28, 0, 1);
  if (opts.bleed != null) uniforms.uBleed.value = sanitizeFinite(opts.bleed, 0.55, 0, 1);
  if (opts.frame != null) uniforms.uFrame.value = sanitizeFinite(opts.frame, 0.72, 0, 1);
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.95, 0, 1);
  const mat = new THREE.ShaderMaterial({
    name: "ImagineNodeMaterial",
    uniforms,
    vertexShader: ImagineNodeShader.vertexShader,
    fragmentShader: ImagineNodeShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Slot tags so context-restore rebind can re-attach kit.paperGrainTexture
  (mat.userData as Record<string, unknown>).painterSlots = {
    paperMap: "uPaperMap",
  };
  setImagineNodePaperMap(mat, opts.paperMap ?? null);
  setImagineNodeMap(mat, opts.map ?? null);
  return mat;
}

/** Bind / clear the Imagine image. Null keeps the procedural wash fallback. Never disposes prior map. */
export function setImagineNodeMap(
  mat: THREE.ShaderMaterial,
  map: THREE.Texture | null | undefined,
): void {
  if (!mat.uniforms?.["uImage"] || !mat.uniforms?.["uHasImage"]) return;
  const tex = map ?? null;
  mat.uniforms["uImage"].value = tex;
  mat.uniforms["uHasImage"].value = tex ? 1 : 0;
  if (tex) tex.needsUpdate = true;
}

/** Bind / clear shared paper-grain. Null falls back to procedural grain in-shader. */
export function setImagineNodePaperMap(
  mat: THREE.ShaderMaterial,
  paper: THREE.Texture | null | undefined,
): void {
  if (!mat.uniforms?.["uPaperMap"] || !mat.uniforms?.["uHasPaper"]) return;
  const tex = paper ?? null;
  mat.uniforms["uPaperMap"].value = tex;
  mat.uniforms["uHasPaper"].value = tex ? 1 : 0;
}

export function tickImagineNodeMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}
