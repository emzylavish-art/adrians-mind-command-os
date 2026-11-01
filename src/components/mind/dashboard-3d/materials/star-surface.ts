import * as THREE from "three";
import { sanitizeShaderTime } from "./paper-grain.ts";
import { WatercolorStarShader } from "../shaders/watercolor-star.ts";

export type StarSurfaceOptions = {
  color?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  grain?: number;
  stroke?: number;
};

function cloneUniforms(src: typeof WatercolorStarShader.uniforms) {
  return {
    uColor: { value: new THREE.Color(...src.uColor.value) },
    uEmissive: { value: src.uEmissive.value },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value },
    uStroke: { value: src.uStroke.value },
  };
}

/** Watercolor ShaderMaterial for bot/star nodes. */
export function createStarWatercolorMaterial(
  opts: StarSurfaceOptions = {},
): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(WatercolorStarShader.uniforms);
  if (opts.color != null) uniforms.uColor.value.set(opts.color);
  if (opts.emissiveIntensity != null) uniforms.uEmissive.value = opts.emissiveIntensity;
  if (opts.grain != null) uniforms.uGrain.value = opts.grain;
  if (opts.stroke != null) uniforms.uStroke.value = opts.stroke;
  return new THREE.ShaderMaterial({
    name: "StarWatercolorMaterial",
    uniforms,
    vertexShader: WatercolorStarShader.vertexShader,
    fragmentShader: WatercolorStarShader.fragmentShader,
    transparent: true,
    depthWrite: true,
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
