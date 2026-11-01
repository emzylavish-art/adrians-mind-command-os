import * as THREE from "three";
import { BrushBuildingShader } from "../shaders/brush-building.ts";
import { sanitizeFinite } from "./paper-grain.ts";

export type BuildingSurfaceOptions = {
  base?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  floors?: number;
  progress?: number;
  paper?: number;
};

function cloneUniforms(src: typeof BrushBuildingShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uAccent: { value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]) },
    uFloors: { value: src.uFloors.value },
    uProgress: { value: src.uProgress.value },
    uTime: { value: 0 },
    uPaper: { value: src.uPaper.value },
  };
}

/** Brush/watercolor ShaderMaterial for project buildings (city flyover). */
export function createBuildingBrushMaterial(
  opts: BuildingSurfaceOptions = {},
): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(BrushBuildingShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.floors != null) uniforms.uFloors.value = sanitizeFinite(opts.floors, 8, 1, 128);
  if (opts.progress != null) uniforms.uProgress.value = sanitizeFinite(opts.progress, 0, 0, 1);
  if (opts.paper != null) uniforms.uPaper.value = sanitizeFinite(opts.paper, 0.18, 0, 1);
  return new THREE.ShaderMaterial({
    name: "BuildingBrushMaterial",
    uniforms,
    vertexShader: BrushBuildingShader.vertexShader,
    fragmentShader: BrushBuildingShader.fragmentShader,
  });
}

export function tickBuildingMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) {
    mat.uniforms["uTime"].value = sanitizeFinite(timeSeconds, 0);
  }
}

export function setBuildingProgress(mat: THREE.ShaderMaterial, progress: number): void {
  if (mat.uniforms["uProgress"]) {
    mat.uniforms["uProgress"].value = sanitizeFinite(progress, 0, 0, 1);
  }
}
