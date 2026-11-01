import * as THREE from "three";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { WatercolorStarShader } from "../shaders/watercolor-star.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type StarSurfaceOptions = {
  color?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  grain?: number;
  stroke?: number;
  /** Brush-stroke corona; defaults from emissive (real status). */
  halo?: number;
};

function cloneUniforms(src: typeof WatercolorStarShader.uniforms) {
  return {
    uColor: { value: new THREE.Color(...src.uColor.value) },
    uEmissive: { value: src.uEmissive.value as number },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value as number },
    uStroke: { value: src.uStroke.value as number },
    uHalo: { value: src.uHalo.value as number },
  };
}

/** Watercolor ShaderMaterial for bot/star nodes (mediump for iOS/WebGL1). */
export function createStarWatercolorMaterial(
  opts: StarSurfaceOptions = {},
): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(WatercolorStarShader.uniforms);
  if (opts.color != null) uniforms.uColor.value.set(opts.color);
  if (opts.emissiveIntensity != null) {
    uniforms.uEmissive.value = sanitizeFinite(opts.emissiveIntensity, 0.85, 0, 3);
  }
  if (opts.grain != null) uniforms.uGrain.value = sanitizeFinite(opts.grain, 0.22, 0, 1);
  if (opts.stroke != null) uniforms.uStroke.value = sanitizeFinite(opts.stroke, 0.55, 0, 1);
  const em = uniforms.uEmissive.value as number;
  if (opts.halo != null) {
    uniforms.uHalo.value = sanitizeFinite(opts.halo, 0.55, 0, 1.5);
  } else {
    // Neutral default from real emissive — idle/low → quiet halo; active → stronger
    uniforms.uHalo.value = sanitizeFinite(0.2 + em * 0.55, 0.55, 0, 1.5);
  }
  return new THREE.ShaderMaterial({
    name: "StarWatercolorMaterial",
    uniforms,
    vertexShader: WatercolorStarShader.vertexShader,
    fragmentShader: WatercolorStarShader.fragmentShader,
    transparent: true,
    depthWrite: true,
    // HACKER (c7): force mediump — highp fails to compile on some iOS Safari / WebGL1 GPUs
    precision: PAINTER_SHADER_PRECISION,
  });
}

/** Procedural brush-tick star sprite (canvas, no external asset). */
export function createStarSpriteTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.85)");
  g.addColorStop(0.55, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.44, size / 2 + Math.sin(a) * size * 0.44);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function tickStarMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

/** Update star pigment from a health color without reallocating the material. */
export function setStarHalo(mat: THREE.ShaderMaterial, halo: number): void {
  if (mat.uniforms["uHalo"]) {
    mat.uniforms["uHalo"].value = sanitizeFinite(halo, 0.55, 0, 1.5);
  }
  (mat.userData as { haloLocked?: boolean }).haloLocked = true;
}

export function setStarWatercolorColor(
  mat: THREE.ShaderMaterial,
  color: THREE.ColorRepresentation,
  emissiveIntensity?: number,
): void {
  if (mat.uniforms["uColor"]) mat.uniforms["uColor"].value.set(color);
  if (emissiveIntensity != null && mat.uniforms["uEmissive"]) {
    const em = sanitizeFinite(emissiveIntensity, 0.85, 0, 3);
    mat.uniforms["uEmissive"].value = em;
    // Keep halo honest to real status emissive unless locked
    if (mat.uniforms["uHalo"] && !(mat.userData as { haloLocked?: boolean }).haloLocked) {
      mat.uniforms["uHalo"].value = sanitizeFinite(0.2 + em * 0.55, 0.55, 0, 1.5);
    }
  }
}
