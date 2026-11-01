import * as THREE from "three";
import { BrushBuildingShader } from "../shaders/brush-building.ts";

export type BuildingSurfaceOptions = {
  base?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  floors?: number;
  progress?: number;
  paper?: number;
};

function cloneUniforms(src: typeof BrushBuildingShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(...src.uBase.value) },
    uAccent: { value: new THREE.Color(...src.uAccent.value) },
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
  if (opts.floors != null) uniforms.uFloors.value = opts.floors;
  if (opts.progress != null) uniforms.uProgress.value = opts.progress;
  if (opts.paper != null) uniforms.uPaper.value = opts.paper;
  return new THREE.ShaderMaterial({
    name: "BuildingBrushMaterial",
    uniforms,
    vertexShader: BrushBuildingShader.vertexShader,
    fragmentShader: BrushBuildingShader.fragmentShader,
  });
}

export function tickBuildingMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = timeSeconds;
}

export function setBuildingProgress(mat: THREE.ShaderMaterial, progress: number): void {
  if (mat.uniforms["uProgress"]) mat.uniforms["uProgress"].value = Math.min(1, Math.max(0, progress));
}
