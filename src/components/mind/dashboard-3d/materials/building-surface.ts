import * as THREE from "three";
import { BrushBuildingShader } from "../shaders/brush-building.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type BuildingSurfaceOptions = {
  base?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  floors?: number;
  /** Real litFloors/floors in [0,1] — never fabricate occupancy. */
  progress?: number;
  paper?: number;
  /** Window wash strength; defaults from progress (0 progress → dark). */
  windowGlow?: number;
};

function cloneUniforms(src: typeof BrushBuildingShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uAccent: { value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]) },
    uFloors: { value: src.uFloors.value },
    uProgress: { value: src.uProgress.value },
    uTime: { value: 0 },
    uPaper: { value: src.uPaper.value },
    uWindowGlow: { value: src.uWindowGlow.value },
  };
}

/** Brush/watercolor ShaderMaterial for project buildings (city flyover). */
export function createBuildingBrushMaterial(
  opts: BuildingSurfaceOptions = {},
): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(BrushBuildingShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  // HACKER (c11): NaN/±Inf/negative floors+progress → finite clamps (never raw GPU NaN)
  if (opts.floors != null) uniforms.uFloors.value = sanitizeFinite(opts.floors, 8, 1, 128);
  if (opts.progress != null) uniforms.uProgress.value = sanitizeFinite(opts.progress, 0, 0, 1);
  if (opts.paper != null) uniforms.uPaper.value = sanitizeFinite(opts.paper, 0.18, 0, 1);
  // Window glow tracks real progress unless explicitly overridden (no fabricated activity)
  const progressVal = uniforms.uProgress.value as number;
  if (opts.windowGlow != null) {
    uniforms.uWindowGlow.value = sanitizeFinite(opts.windowGlow, progressVal > 0 ? 0.85 : 0, 0, 1.5);
  } else {
    uniforms.uWindowGlow.value = progressVal > 0 ? sanitizeFinite(0.55 + progressVal * 0.55, 0.85, 0, 1.5) : 0;
  }
  return new THREE.ShaderMaterial({
    name: "BuildingBrushMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: BrushBuildingShader.vertexShader,
    fragmentShader: BrushBuildingShader.fragmentShader,
  });
}

export function tickBuildingMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) {
    mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
  }
}

export function setBuildingProgress(mat: THREE.ShaderMaterial, progress: number): void {
  const p = sanitizeFinite(progress, 0, 0, 1);
  if (mat.uniforms["uProgress"]) mat.uniforms["uProgress"].value = p;
  // Keep window wash honest to real progress unless caller set a custom glow later
  if (mat.uniforms["uWindowGlow"] && !(mat.userData as { windowGlowLocked?: boolean }).windowGlowLocked) {
    mat.uniforms["uWindowGlow"].value = p > 0 ? sanitizeFinite(0.55 + p * 0.55, 0.85, 0, 1.5) : 0;
  }
}

/** Explicit window wash; locks auto-sync from setBuildingProgress. */
export function setBuildingWindowGlow(mat: THREE.ShaderMaterial, glow: number): void {
  if (mat.uniforms["uWindowGlow"]) {
    mat.uniforms["uWindowGlow"].value = sanitizeFinite(glow, 0, 0, 1.5);
  }
  (mat.userData as { windowGlowLocked?: boolean }).windowGlowLocked = true;
}
