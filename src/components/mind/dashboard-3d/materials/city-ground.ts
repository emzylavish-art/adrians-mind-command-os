import * as THREE from "three";
import { CityGroundShader } from "../shaders/city-ground.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import { applyPainterOutputSafeFlags } from "./painter-output.ts";
import { applyPainterLogDepthSupport, PAINTER_RENDER_ORDER } from "./painter-depth.ts";

/** Soft clamp for plaza world-radius → shader UV scale. */
export const CITY_GROUND_PLAZA_SCALE_MIN = 0.05;
export const CITY_GROUND_PLAZA_SCALE_MAX = 64;
export const CITY_GROUND_PLAZA_SCALE_DEFAULT = 1;

export type CityGroundOptions = {
  base?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  grain?: number;
  wet?: number;
  /** Ring strength 0..1; 0/NaN/missing → honest flat wash (no fabricated rings). */
  ring?: number;
  opacity?: number;
  /**
   * Plaza world radius relative to unit circle (CircleGeometry radius / 40 default).
   * Extreme sizes stay mediump-safe via paintWrap in shader.
   */
  plazaScale?: number;
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
    uPlazaScale: {
      value: (src as { uPlazaScale?: { value: number } }).uPlazaScale?.value ?? CITY_GROUND_PLAZA_SCALE_DEFAULT,
    },
  };
}

/** Map CircleGeometry radius → shader plazaScale (neutral 1 at radius 40). */
export function cityGroundPlazaScaleFromRadius(radius: number): number {
  const r = sanitizeFinite(radius, 40, 0.01, 1e6);
  return sanitizeFinite(
    r / 40,
    CITY_GROUND_PLAZA_SCALE_DEFAULT,
    CITY_GROUND_PLAZA_SCALE_MIN,
    CITY_GROUND_PLAZA_SCALE_MAX,
  );
}

/**
 * Painterly city plaza ground (c24/c25) — replaces MeshStandardMaterial dark-glass + GridHelper.
 * depthWrite stays true so buildings occlude correctly on the plaza.
 */
export function createCityGroundMaterial(opts: CityGroundOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(CityGroundShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.ink != null) uniforms.uInk.value.set(opts.ink);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.grain != null) uniforms.uGrain.value = sanitizeFinite(opts.grain, 0.22, 0, 1);
  if (opts.wet != null) uniforms.uWet.value = sanitizeFinite(opts.wet, 0.55, 0, 1);
  // undefined → default wash rings; explicit NaN/Inf → 0 (no fabricated rings)
  if (opts.ring === undefined) {
    uniforms.uRing.value = sanitizeFinite(
      CityGroundShader.uniforms.uRing.value as number,
      0.45,
      0,
      1,
    );
  } else if (!Number.isFinite(Number(opts.ring))) {
    uniforms.uRing.value = 0;
  } else {
    uniforms.uRing.value = sanitizeFinite(Number(opts.ring), 0, 0, 1);
  }
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.94, 0, 1);
  uniforms.uPlazaScale.value = sanitizeFinite(
    opts.plazaScale ?? CITY_GROUND_PLAZA_SCALE_DEFAULT,
    CITY_GROUND_PLAZA_SCALE_DEFAULT,
    CITY_GROUND_PLAZA_SCALE_MIN,
    CITY_GROUND_PLAZA_SCALE_MAX,
  );
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

/** Set ring strength; NaN/Inf → 0 (no data). */
export function setCityGroundRing(mat: THREE.ShaderMaterial, ring: number): number {
  if (!mat?.uniforms?.["uRing"] || mat.name !== "CityGroundMaterial") return 0;
  const v =
    !Number.isFinite(Number(ring)) ? 0 : sanitizeFinite(Number(ring), 0, 0, 1);
  mat.uniforms["uRing"].value = v;
  return v;
}

/** Set plaza scale from world radius or raw scale. */
export function setCityGroundPlazaScale(
  mat: THREE.ShaderMaterial,
  scaleOrRadius: number,
  opts: { asRadius?: boolean } = {},
): number {
  if (!mat?.uniforms?.["uPlazaScale"] || mat.name !== "CityGroundMaterial") {
    return CITY_GROUND_PLAZA_SCALE_DEFAULT;
  }
  const v = opts.asRadius
    ? cityGroundPlazaScaleFromRadius(scaleOrRadius)
    : sanitizeFinite(
        scaleOrRadius,
        CITY_GROUND_PLAZA_SCALE_DEFAULT,
        CITY_GROUND_PLAZA_SCALE_MIN,
        CITY_GROUND_PLAZA_SCALE_MAX,
      );
  mat.uniforms["uPlazaScale"].value = v;
  return v;
}

export function tickCityGroundMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (!mat || (mat as { disposed?: boolean }).disposed) return;
  if (mat.name !== "CityGroundMaterial") return;
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}
