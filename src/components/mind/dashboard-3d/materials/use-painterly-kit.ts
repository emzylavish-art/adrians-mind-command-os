/**
 * Painterly kit for Dashboard Bot / universe-scene wiring.
 *
 * OWNER WIRING (do not apply from painter lane — Dashboard Bot owns scene):
 * 1. import { createPainterlyKit, tickPainterlyKit } from ".../materials";
 * 2. const kit = createPainterlyKit(); add kit.painterlyPass after bloom on EffectComposer.
 * 3. Replace MeshStandardMaterial bot/star meshes with kit.createStarMaterial(healthColor).
 * 4. For city buildings: kit.createBuildingMaterial({ floors, progress, accent }).
 * 5. Sky dome: kit.createSkyMaterial(); star sprites: kit.starSpriteTexture.
 * 6. Each frame: tickPainterlyKit(kit, elapsedSeconds).
 * 7. On unmount: disposePainterlyKit(kit).
 */
import * as THREE from "three";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  createPainterlyPass,
  tickPainterlyPass,
  type PainterlyPassOptions,
} from "../shaders/painterly-pass.ts";
import {
  createStarWatercolorMaterial,
  createStarSpriteTexture,
  tickStarMaterial,
  type StarSurfaceOptions,
} from "./star-surface.ts";
import {
  createBuildingBrushMaterial,
  tickBuildingMaterial,
  type BuildingSurfaceOptions,
} from "./building-surface.ts";
import { createNebulaSkyMaterial, type NebulaTextureOptions } from "./nebula-sky.ts";
import { createPaperGrainTexture } from "./paper-grain.ts";

export type PainterlyKitOptions = {
  pass?: PainterlyPassOptions;
  nebula?: NebulaTextureOptions;
};

export type PainterlyKit = {
  painterlyPass: ShaderPass;
  starSpriteTexture: THREE.CanvasTexture;
  paperGrainTexture: THREE.DataTexture;
  tracked: THREE.ShaderMaterial[];
  createStarMaterial: (opts?: StarSurfaceOptions) => THREE.ShaderMaterial;
  createBuildingMaterial: (opts?: BuildingSurfaceOptions) => THREE.ShaderMaterial;
  createSkyMaterial: (opts?: NebulaTextureOptions) => THREE.MeshBasicMaterial;
};

export function createPainterlyKit(opts: PainterlyKitOptions = {}): PainterlyKit {
  const tracked: THREE.ShaderMaterial[] = [];
  const kit: PainterlyKit = {
    painterlyPass: createPainterlyPass(opts.pass),
    starSpriteTexture: createStarSpriteTexture(),
    paperGrainTexture: createPaperGrainTexture({ size: 256, seed: 7 }),
    tracked,
    createStarMaterial(starOpts) {
      const m = createStarWatercolorMaterial(starOpts);
      tracked.push(m);
      return m;
    },
    createBuildingMaterial(bOpts) {
      const m = createBuildingBrushMaterial(bOpts);
      tracked.push(m);
      return m;
    },
    createSkyMaterial(skyOpts) {
      return createNebulaSkyMaterial(skyOpts ?? opts.nebula);
    },
  };
  return kit;
}

export function tickPainterlyKit(kit: PainterlyKit, timeSeconds: number): void {
  tickPainterlyPass(kit.painterlyPass, timeSeconds);
  for (const m of kit.tracked) {
    if (m.name === "StarWatercolorMaterial") tickStarMaterial(m, timeSeconds);
    else if (m.name === "BuildingBrushMaterial") tickBuildingMaterial(m, timeSeconds);
    else if (m.uniforms?.["uTime"]) m.uniforms["uTime"].value = timeSeconds;
  }
}

export function disposePainterlyKit(kit: PainterlyKit): void {
  kit.starSpriteTexture.dispose();
  kit.paperGrainTexture.dispose();
  for (const m of kit.tracked) m.dispose();
  kit.tracked.length = 0;
  const u = kit.painterlyPass.uniforms["tDiffuse"];
  if (u?.value && typeof (u.value as THREE.Texture).dispose === "function") {
    // leave composer-owned target alone
  }
}

/** Hook-shaped export for React scene owners (call inside useEffect, not render). */
export function usePainterlyKitFactory() {
  return { createPainterlyKit, tickPainterlyKit, disposePainterlyKit };
}
