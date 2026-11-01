/**
 * Painterly kit for Dashboard Bot / universe-scene wiring.
 *
 * OWNER WIRING (do not apply from painter lane — Dashboard Bot owns scene):
 * 1. import { createPainterlyKit, tickPainterlyKit, disposePainterlyKit } from ".../materials";
 * 2. const kit = createPainterlyKit(); composer.addPass(kit.painterlyPass);
 * 3. Stars: kit.createStarMaterial({ color }); Buildings: kit.createBuildingMaterial({...});
 * 4. Lore plaques: kit.createLorePlaqueMaterial({ accent }); edges: kit.createInkWashEdgeMaterial({ health });
 * 5. Sky: kit.createSkyMaterial();
 * 5. attachPainterlyContextHandlers(renderer, kit) for webglcontextlost/restore.
 * 6. Each frame: tickPainterlyKit(kit, t); on unmount: disposePainterlyKit(kit).
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
import {
  createLorePlaqueMaterial as createLorePlaqueMaterialImpl,
  tickLorePlaqueMaterial,
  type LorePlaqueOptions,
} from "./lore-plaque.ts";
import {
  createInkWashEdgeMaterial as createInkWashEdgeMaterialImpl,
  tickInkWashEdgeMaterial,
  type InkWashEdgeOptions,
} from "./ink-wash-edge.ts";
import { createNebulaSkyMaterial, type NebulaTextureOptions } from "./nebula-sky.ts";
import { createPaperGrainTexture, sanitizeShaderTime } from "./paper-grain.ts";

export type PainterlyKitOptions = {
  pass?: PainterlyPassOptions;
  nebula?: NebulaTextureOptions;
};

export type PainterlyKit = {
  painterlyPass: ShaderPass;
  starSpriteTexture: THREE.CanvasTexture | THREE.DataTexture;
  paperGrainTexture: THREE.DataTexture;
  tracked: THREE.ShaderMaterial[];
  /** Sky materials created via createSkyMaterial — MUST be disposed (was a leak). */
  trackedSkies: THREE.MeshBasicMaterial[];
  disposed: boolean;
  contextLost: boolean;
  createStarMaterial: (opts?: StarSurfaceOptions) => THREE.ShaderMaterial;
  createBuildingMaterial: (opts?: BuildingSurfaceOptions) => THREE.ShaderMaterial;
  createLorePlaqueMaterial: (opts?: LorePlaqueOptions) => THREE.ShaderMaterial;
  createInkWashEdgeMaterial: (opts?: InkWashEdgeOptions) => THREE.ShaderMaterial;
  createSkyMaterial: (opts?: NebulaTextureOptions) => THREE.MeshBasicMaterial;
};

export function createPainterlyKit(opts: PainterlyKitOptions = {}): PainterlyKit {
  const tracked: THREE.ShaderMaterial[] = [];
  const trackedSkies: THREE.MeshBasicMaterial[] = [];
  const kit: PainterlyKit = {
    painterlyPass: createPainterlyPass(opts.pass),
    starSpriteTexture: createStarSpriteTexture(),
    paperGrainTexture: createPaperGrainTexture({ size: 256, seed: 7 }),
    tracked,
    trackedSkies,
    disposed: false,
    contextLost: false,
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
    createLorePlaqueMaterial(pOpts) {
      const m = createLorePlaqueMaterialImpl(pOpts);
      tracked.push(m);
      return m;
    },
    createInkWashEdgeMaterial(eOpts) {
      const m = createInkWashEdgeMaterialImpl(eOpts);
      tracked.push(m);
      return m;
    },
    createSkyMaterial(skyOpts) {
      const m = createNebulaSkyMaterial(skyOpts ?? opts.nebula);
      trackedSkies.push(m);
      return m;
    },
  };
  return kit;
}

export function tickPainterlyKit(kit: PainterlyKit, timeSeconds: number): void {
  if (kit.disposed || kit.contextLost) return;
  tickPainterlyPass(kit.painterlyPass, timeSeconds);
  for (const m of kit.tracked) {
    if (m.name === "StarWatercolorMaterial") tickStarMaterial(m, timeSeconds);
    else if (m.name === "BuildingBrushMaterial") tickBuildingMaterial(m, timeSeconds);
    else if (m.name === "LorePlaqueMaterial") tickLorePlaqueMaterial(m, timeSeconds);
    else if (m.name === "InkWashEdgeMaterial") tickInkWashEdgeMaterial(m, timeSeconds);
    else if (m.uniforms?.["uTime"]) m.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
  }
}

/**
 * Dispose all kit-owned GPU resources. Idempotent.
 * HACKER FIX: previously createSkyMaterial maps/materials were never disposed.
 */
export function disposePainterlyKit(kit: PainterlyKit): void {
  if (kit.disposed) return;
  kit.disposed = true;
  kit.starSpriteTexture.dispose();
  kit.paperGrainTexture.dispose();
  for (const m of kit.tracked) m.dispose();
  kit.tracked.length = 0;
  for (const sky of kit.trackedSkies) {
    sky.map?.dispose();
    sky.dispose();
  }
  kit.trackedSkies.length = 0;
}

/**
 * Release one kit-created material (e.g. edge ribbons rebuilt on every status poll).
 * HACKER FIX (c3): without this, rebuilt materials stay in kit.tracked forever —
 * unbounded growth + ticking disposed materials. Returns true if it was tracked.
 */
export function releasePainterlyMaterial(
  kit: PainterlyKit,
  mat: THREE.ShaderMaterial | THREE.MeshBasicMaterial,
): boolean {
  const i = kit.tracked.indexOf(mat as THREE.ShaderMaterial);
  if (i >= 0) {
    kit.tracked.splice(i, 1);
    mat.dispose();
    return true;
  }
  const j = kit.trackedSkies.indexOf(mat as THREE.MeshBasicMaterial);
  if (j >= 0) {
    kit.trackedSkies.splice(j, 1);
    (mat as THREE.MeshBasicMaterial).map?.dispose();
    mat.dispose();
    return true;
  }
  return false;
}

/** Pure helper for tests: count outstanding disposables before/after dispose. */
export function painterlyKitResourceCounts(kit: PainterlyKit): {
  materials: number;
  skies: number;
  disposed: boolean;
} {
  return {
    materials: kit.tracked.length,
    skies: kit.trackedSkies.length,
    disposed: kit.disposed,
  };
}

/**
 * WebGL context loss/restore: pause ticks on loss; on restore recreate CPU textures
 * that hold canvas/data uploads (star sprite + paper grain). Does not silently
 * swallow errors — sets kit.contextLost and returns whether restore rebuilt.
 */
export function attachPainterlyContextHandlers(
  canvas: HTMLCanvasElement,
  kit: PainterlyKit,
  rebuild?: () => void,
): () => void {
  const onLost = (ev: Event) => {
    ev.preventDefault();
    kit.contextLost = true;
  };
  const onRestored = () => {
    kit.contextLost = false;
    // Recreate upload textures (old GPU ids are invalid after context loss)
    try {
      kit.starSpriteTexture.dispose();
    } catch {
      /* already invalid */
    }
    try {
      kit.paperGrainTexture.dispose();
    } catch {
      /* already invalid */
    }
    kit.starSpriteTexture = createStarSpriteTexture();
    kit.paperGrainTexture = createPaperGrainTexture({ size: 256, seed: 7 });
    rebuild?.();
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost, false);
    canvas.removeEventListener("webglcontextrestored", onRestored, false);
  };
}

export function usePainterlyKitFactory() {
  return {
    createPainterlyKit,
    tickPainterlyKit,
    disposePainterlyKit,
    attachPainterlyContextHandlers,
    painterlyKitResourceCounts,
    releasePainterlyMaterial,
  };
}
