import * as THREE from "three";
import { CityGroundShader } from "../shaders/city-ground.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import { applyPainterOutputSafeFlags } from "./painter-output.ts";
import { applyPainterLogDepthSupport, PAINTER_RENDER_ORDER } from "./painter-depth.ts";

export type CityGroundOptions = {
  base?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  grain?: number;
  wet?: number;
  ring?: number;
  opacity?: number;
};

function cloneUniforms(src: typeof CityGroundShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uInk: { value: new THREE.Color(src.uInk.value[0], src.uInk.value[1], src.uInk.value[2]) },
    uAccent: {
      value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]),
    },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value as number },
    uWet: { value: src.uWet.value as number },
    uRing: { value: src.uRing.value as number },
    uOpacity: { value: src.uOpacity.value as number },
  };
}

/**
 * Painterly city plaza ground (c24) — replaces MeshStandardMaterial dark-glass + GridHelper.
 * depthWrite stays true so buildings occlude correctly on the plaza.
 */
export function createCityGroundMaterial(opts: CityGroundOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(CityGroundShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.ink != null) uniforms.uInk.value.set(opts.ink);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.grain != null) uniforms.uGrain.value = sanitizeFinite(opts.grain, 0.22, 0, 1);
  if (opts.wet != null) uniforms.uWet.value = sanitizeFinite(opts.wet, 0.55, 0, 1);
  if (opts.ring != null) uniforms.uRing.value = sanitizeFinite(opts.ring, 0.45, 0, 1);
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.94, 0, 1);
  const mat = new THREE.ShaderMaterial({
    name: "CityGroundMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: CityGroundShader.vertexShader,
    fragmentShader: CityGroundShader.fragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  (mat.userData as Record<string, unknown>).painterRenderOrder = PAINTER_RENDER_ORDER.ground;
  applyPainterLogDepthSupport(mat);
  applyPainterOutputSafeFlags(mat, { transparent: true, premultipliedAlpha: true });
  (mat.userData as Record<string, unknown>).painterCityGround = true;
  return mat;
}

export function tickCityGroundMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (!mat || (mat as { disposed?: boolean }).disposed) return;
  if (mat.name !== "CityGroundMaterial") return;
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}
