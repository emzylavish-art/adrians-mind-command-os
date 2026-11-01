/**
 * Painterly kit for Dashboard Bot / universe-scene wiring.
 *
 * OWNER WIRING (do not apply from painter lane — Dashboard Bot owns scene):
 * 1. import { createPainterlyKit, tickPainterlyKit, disposePainterlyKit } from ".../materials";
 * 2. const kit = createPainterlyKit(); composer.addPass(kit.painterlyPass);
 * 3. Stars: kit.createStarMaterial({ color }); Buildings: kit.createBuildingMaterial({...});
 * 4. Lore plaques: kit.createLorePlaqueMaterial({ accent }); edges: kit.createInkEdges(edges) (batched) or kit.createInkWashEdgeMaterial;
 * 5. Imagine cards/sprites: kit.createImagineNodeMaterial({ map }); setImagineNodeMap when load completes
 * 6. Sky: kit.createSkyMaterial(); lane clouds: kit.createLaneNebulae(lanes);
 * 7. attachPainterlyContextHandlers(renderer, kit) for webglcontextlost/restore.
 * 8. Each frame: tickPainterlyKit(kit, t, { reducedMotion }); kit.setPassHealth({ healthy, total, reducedMotion }).
 * 9. On resize: kit.resizePass(cssW, cssH, dpr); on unmount: disposePainterlyKit(kit).
 */
import * as THREE from "three";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  createPainterlyPass,
  tickPainterlyPass,
  disposePainterlyPass,
  resizePainterlyPass,
  setPainterlyPassHealth,
  type PainterlyPassOptions,
  type PainterlyHealthInputs,
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
  disposeLorePlaqueOwnedAtlas,
  type LorePlaqueOptions,
} from "./lore-plaque.ts";
import {
  createInkWashEdgeMaterial as createInkWashEdgeMaterialImpl,
  tickInkWashEdgeMaterial,
  type InkWashEdgeOptions,
} from "./ink-wash-edge.ts";
import {
  createImagineNodeMaterial as createImagineNodeMaterialImpl,
  tickImagineNodeMaterial,
  setImagineNodePaperMap,
  disposeImagineNodeOwnedMaps,
  type ImagineNodeOptions,
} from "./imagine-node.ts";
import { createNebulaSkyMaterial, createNebulaTexture, type NebulaTextureOptions } from "./nebula-sky.ts";
import { createPaperGrainTexture, sanitizeShaderTime } from "./paper-grain.ts";
import {
  createPainterlyBotStar,
  type PainterlyBotStarOptions,
  type PainterlyBotStarBundle,
} from "./painterly-bot-star.ts";
import {
  createPainterlyInkEdges,
  type PainterlyInkEdgeInput,
  type PainterlyInkEdgesOptions,
  type PainterlyInkEdgesHandle,
} from "./painterly-ink-edges.ts";
import {
  createPainterlyLaneNebulae,
  createLaneNebulaMaterial as createLaneNebulaMaterialImpl,
  tickLaneNebulaMaterial,
  type LaneNebulaInput,
  type LaneNebulaOptions,
  type PainterlyLaneNebulaeHandle,
} from "./lane-nebula.ts";
import {
  estimateTextureBytes,
  pushBudgetItem,
  sanitizeTextureBudgetBytes,
  PAINTER_TEXTURE_BUDGET_BYTES,
  type PainterlyTextureBudgetReport,
} from "./painter-texture-budget.ts";
import { markImagineNodeReleased } from "./imagine-node.ts";

export type PainterlyKitOptions = {
  pass?: PainterlyPassOptions;
  nebula?: NebulaTextureOptions;
  /** Soft cap for painter-owned texture bytes (default 48MiB). */
  textureBudgetBytes?: number;
};

/** Options for tickPainterlyKit — reducedMotion freezes all painter uTime washes. */
export type PainterlyTickOptions = {
  /** When true, do not advance uTime / pass animation (low-power / a11y). */
  reducedMotion?: boolean;
};

/** Shared kit texture slots that survive context restore via rebind. */
export type PainterlyTextureSlot = "paperGrain" | "starSprite";

export type PainterlyTextureBinding = {
  /** Material that holds a reference to a kit-owned texture. */
  material: THREE.Material;
  slot: PainterlyTextureSlot;
  /**
   * ShaderMaterial uniform name (e.g. "uPaperMap"), or "map" for MeshBasic/Sprite.
   * Defaults to "map".
   */
  target?: string;
};

export type PainterlyKit = {
  painterlyPass: ShaderPass;
  starSpriteTexture: THREE.CanvasTexture | THREE.DataTexture;
  paperGrainTexture: THREE.DataTexture;
  tracked: THREE.ShaderMaterial[];
  /** Sky materials created via createSkyMaterial — MUST be disposed (was a leak). */
  trackedSkies: THREE.MeshBasicMaterial[];
  /**
   * External consumers (e.g. SpriteMaterial.map = kit.starSpriteTexture) that must
   * be re-pointed after context restore recreates kit textures.
   */
  textureBindings: PainterlyTextureBinding[];
  disposed: boolean;
  contextLost: boolean;
  createStarMaterial: (opts?: StarSurfaceOptions) => THREE.ShaderMaterial;
  createBuildingMaterial: (opts?: BuildingSurfaceOptions) => THREE.ShaderMaterial;
  createLorePlaqueMaterial: (opts?: LorePlaqueOptions) => THREE.ShaderMaterial;
  createInkWashEdgeMaterial: (opts?: InkWashEdgeOptions) => THREE.ShaderMaterial;
  createImagineNodeMaterial: (opts?: ImagineNodeOptions) => THREE.ShaderMaterial;
  createSkyMaterial: (opts?: NebulaTextureOptions) => THREE.MeshBasicMaterial;
  /**
   * Register a material that captured kit.starSpriteTexture / paperGrainTexture
   * (Dashboard Bot SpriteMaterials). Required so restore can re-attach.
   */
  bindSharedTexture: (
    material: THREE.Material,
    slot: PainterlyTextureSlot,
    target?: string,
  ) => void;
  /** Drive painterly post-pass amount from real healthy/total counts (no allocations). */
  setPassHealth: (input: PainterlyHealthInputs) => number;
  /** Sanitize CSS×DPR resize; skips RT thrash when drawing size unchanged. */
  resizePass: (width: number, height: number, dpr?: number) => void;
  /**
   * One-line bot star adopt: watercolor mesh + glow sprite (replaces MeshStandardMaterial).
   * Glow is auto bindSharedTexture'd to kit.starSpriteTexture.
   */
  createBotStar: (opts?: PainterlyBotStarOptions) => PainterlyBotStarBundle;
  /**
   * One-line ink-wash constellation edges (replaces LineDashedMaterial rebuildEdges).
   * Batches by health → ≤4 draw calls; handle.update / handle.dispose.
   */
  createInkEdges: (
    edges?: PainterlyInkEdgeInput[],
    opts?: PainterlyInkEdgesOptions,
  ) => PainterlyInkEdgesHandle;
  createLaneNebulaMaterial: (opts?: LaneNebulaOptions) => THREE.ShaderMaterial;
  /**
   * One-line constellation lane nebulae (replaces MeshBasicMaterial tint spheres).
   */
  createLaneNebulae: (lanes?: LaneNebulaInput[]) => PainterlyLaneNebulaeHandle;
  /** Soft GPU texture budget in bytes (sanitized). */
  textureBudgetBytes: number;
  /** Report estimated texture bytes across kit-owned / tracked maps. */
  textureBudget: () => PainterlyTextureBudgetReport;
  /** Detach context listeners (set by attachPainterlyContextHandlers). */
  detachContext: (() => void) | null;
  /** Last per-material tick error message (null if healthy). Never throws out of tick. */
  lastTickError: string | null;
  /** How many materials threw inside the last tickPainterlyKit call. */
  lastTickErrorCount: number;
  /** How many uTime (or pass) uniform writes the last tick performed. */
  lastTickUniformWrites: number;
  /** Frozen clock used while reducedMotion is honored. */
  frozenTickTime: number;
};

/** HACKER (c7): track live kits so StrictMode double-mount leaks can be audited/disposed. */
const LIVE_PAINTER_KITS = new Set<PainterlyKit>();

export function livePainterlyKitCount(): number {
  return LIVE_PAINTER_KITS.size;
}

/** Dispose every undisposed kit (tests / emergency). Returns how many were disposed. */
export function disposeAllPainterlyKits(): number {
  let n = 0;
  for (const k of [...LIVE_PAINTER_KITS]) {
    if (!k.disposed) {
      disposePainterlyKit(k);
      n += 1;
    }
  }
  return n;
}

export function createPainterlyKit(opts: PainterlyKitOptions = {}): PainterlyKit {
  const tracked: THREE.ShaderMaterial[] = [];
  const trackedSkies: THREE.MeshBasicMaterial[] = [];
  const textureBindings: PainterlyTextureBinding[] = [];
  const textureBudgetBytes = sanitizeTextureBudgetBytes(
    opts.textureBudgetBytes ?? PAINTER_TEXTURE_BUDGET_BYTES,
  );
  const kit: PainterlyKit = {
    painterlyPass: createPainterlyPass(opts.pass),
    starSpriteTexture: createStarSpriteTexture(),
    paperGrainTexture: createPaperGrainTexture({ size: 256, seed: 7 }),
    tracked,
    trackedSkies,
    textureBindings,
    disposed: false,
    contextLost: false,
    detachContext: null,
    lastTickError: null,
    lastTickErrorCount: 0,
    lastTickUniformWrites: 0,
    frozenTickTime: 0,
    textureBudgetBytes,
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
    createImagineNodeMaterial(iOpts) {
      const m = createImagineNodeMaterialImpl({
        ...iOpts,
        paperMap: iOpts?.paperMap === undefined ? kit.paperGrainTexture : iOpts.paperMap,
      });
      tracked.push(m);
      // Auto-bind paper slot so restore re-attaches the NEW paperGrainTexture object
      textureBindings.push({ material: m, slot: "paperGrain", target: "uPaperMap" });
      return m;
    },
    createSkyMaterial(skyOpts) {
      const m = createNebulaSkyMaterial(skyOpts ?? opts.nebula);
      trackedSkies.push(m);
      return m;
    },
    bindSharedTexture(material, slot, target = "map") {
      // Replace existing binding for same material+slot
      for (let i = textureBindings.length - 1; i >= 0; i--) {
        const b = textureBindings[i]!;
        if (b.material === material && b.slot === slot) textureBindings.splice(i, 1);
      }
      textureBindings.push({ material, slot, target });
      applyTextureBinding(kit, { material, slot, target });
    },
    setPassHealth(input) {
      if (kit.disposed) return 0;
      return setPainterlyPassHealth(kit.painterlyPass, input);
    },
    resizePass(width, height, dpr = 1) {
      // HACKER (c11): mid context-loss resize must not thrash pass RTs
      if (kit.disposed || kit.contextLost) return;
      resizePainterlyPass(kit.painterlyPass, width, height, dpr);
    },
    createBotStar(starOpts) {
      return createPainterlyBotStar(kit, starOpts);
    },
    createInkEdges(edges = [], eOpts) {
      return createPainterlyInkEdges(kit, edges, eOpts);
    },
    createLaneNebulaMaterial(nOpts) {
      const m = createLaneNebulaMaterialImpl(nOpts);
      tracked.push(m);
      return m;
    },
    createLaneNebulae(lanes = []) {
      return createPainterlyLaneNebulae(kit, lanes);
    },
    textureBudget() {
      return painterlyKitTextureBudget(kit);
    },
  };
  LIVE_PAINTER_KITS.add(kit);
  return kit;
}

function textureForSlot(
  kit: PainterlyKit,
  slot: PainterlyTextureSlot,
): THREE.Texture {
  return slot === "paperGrain" ? kit.paperGrainTexture : kit.starSpriteTexture;
}

/** Apply one binding to a live material (uniform or .map). */
export function applyTextureBinding(kit: PainterlyKit, binding: PainterlyTextureBinding): boolean {
  if (kit.disposed) return false;
  const tex = textureForSlot(kit, binding.slot);
  const target = binding.target ?? "map";
  const mat = binding.material as THREE.ShaderMaterial & {
    map?: THREE.Texture | null;
    needsUpdate?: boolean;
    uniforms?: Record<string, { value: unknown }>;
  };
  if (mat.uniforms && target in mat.uniforms) {
    mat.uniforms[target]!.value = tex;
    if (target === "uPaperMap" && mat.uniforms["uHasPaper"]) {
      mat.uniforms["uHasPaper"].value = 1;
    }
    return true;
  }
  if (target === "map" && "map" in mat) {
    mat.map = tex;
    mat.needsUpdate = true;
    return true;
  }
  return false;
}

/**
 * HACKER FIX (c4): after webglcontextrestored the kit recreates paperGrain /
 * starSprite (and sky nebula) textures. Materials that captured the OLD objects
 * (SpriteMaterial.map, Imagine uPaperMap, etc.) would stay blank unless rebound.
 * Returns how many attachments were refreshed.
 */
export function rebindPainterlyKitTextures(kit: PainterlyKit): number {
  if (kit.disposed) return 0;
  let n = 0;
  // Force CPU→GPU re-upload of kit-owned textures
  kit.starSpriteTexture.needsUpdate = true;
  kit.paperGrainTexture.needsUpdate = true;
  n += 2;

  for (const b of kit.textureBindings) {
    if (applyTextureBinding(kit, b)) n += 1;
  }

  // Imagine materials: mark loaded image textures for re-upload + refresh paper slot
  for (const m of kit.tracked) {
    if (m.name !== "ImagineNodeMaterial") continue;
    const img = m.uniforms?.["uImage"]?.value as THREE.Texture | null | undefined;
    if (img) {
      img.needsUpdate = true;
      n += 1;
    }
    setImagineNodePaperMap(m, kit.paperGrainTexture);
    n += 1;
  }

  // Sky nebula CanvasTextures are also invalid after context loss — recreate maps
  for (const sky of kit.trackedSkies) {
    try {
      sky.map?.dispose();
    } catch {
      /* already invalid */
    }
    sky.map = createNebulaTexture();
    sky.needsUpdate = true;
    n += 1;
  }

  return n;
}

/**
 * Drive all kit material clocks.
 * HACKER (c10): `reducedMotion` freezes uTime at kit.frozenTickTime (no wash/flicker
 * animation) and still reports lastTickUniformWrites so cost stays visible.
 * Pass animation is also frozen under reducedMotion.
 */
export function tickPainterlyKit(
  kit: PainterlyKit,
  timeSeconds: number,
  opts: PainterlyTickOptions = {},
): void {
  if (kit.disposed || kit.contextLost) return;
  kit.lastTickError = null;
  kit.lastTickErrorCount = 0;
  kit.lastTickUniformWrites = 0;
  const reduced = !!opts.reducedMotion;
  const t = reduced ? kit.frozenTickTime : timeSeconds;
  if (!reduced) kit.frozenTickTime = timeSeconds;
  try {
    tickPainterlyPass(kit.painterlyPass, t);
    kit.lastTickUniformWrites += 1;
  } catch (err) {
    kit.lastTickErrorCount += 1;
    kit.lastTickError = err instanceof Error ? err.message : String(err);
  }
  for (const m of kit.tracked) {
    try {
      // Skip materials without a time uniform when reduced — still count tracked
      if (reduced && !m.uniforms?.["uTime"]) continue;
      if (m.name === "StarWatercolorMaterial") tickStarMaterial(m, t);
      else if (m.name === "BuildingBrushMaterial") tickBuildingMaterial(m, t);
      else if (m.name === "LorePlaqueMaterial") tickLorePlaqueMaterial(m, t);
      else if (m.name === "InkWashEdgeMaterial") tickInkWashEdgeMaterial(m, t);
      else if (m.name === "ImagineNodeMaterial") tickImagineNodeMaterial(m, t);
      else if (m.name === "LaneNebulaMaterial") tickLaneNebulaMaterial(m, t);
      else if (m.uniforms?.["uTime"]) m.uniforms["uTime"].value = sanitizeShaderTime(t);
      else continue;
      kit.lastTickUniformWrites += 1;
    } catch (err) {
      // HACKER (c7): one bad material must not abort the whole frame / freeze the dashboard
      kit.lastTickErrorCount += 1;
      kit.lastTickError = err instanceof Error ? err.message : String(err);
    }
  }
}

/**
 * Dispose all kit-owned GPU resources. Idempotent.
 * HACKER FIX: previously createSkyMaterial maps/materials were never disposed.
 * Does NOT dispose Imagine image maps (caller-owned TextureLoader results).
 */
export function disposePainterlyKit(kit: PainterlyKit): void {
  if (kit.disposed) return;
  kit.disposed = true;
  // HACKER (c7): always drop context listeners (StrictMode remount / forgotten detach)
  try {
    kit.detachContext?.();
  } catch {
    /* */
  }
  kit.detachContext = null;
  LIVE_PAINTER_KITS.delete(kit);
  disposePainterlyPass(kit.painterlyPass);
  kit.starSpriteTexture.dispose();
  kit.paperGrainTexture.dispose();
  for (const m of kit.tracked) {
    if (m.name === "ImagineNodeMaterial") disposeImagineNodeOwnedMaps(m);
    if (m.name === "LorePlaqueMaterial") disposeLorePlaqueOwnedAtlas(m);
    m.dispose();
  }
  kit.tracked.length = 0;
  for (const sky of kit.trackedSkies) {
    sky.map?.dispose();
    sky.dispose();
  }
  kit.trackedSkies.length = 0;
  kit.textureBindings.length = 0;
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
    // Drop texture bindings for this material
    for (let b = kit.textureBindings.length - 1; b >= 0; b--) {
      if (kit.textureBindings[b]!.material === mat) kit.textureBindings.splice(b, 1);
    }
    if ((mat as THREE.ShaderMaterial).name === "ImagineNodeMaterial") {
      // HACKER (c9): mark released BEFORE dispose so in-flight TextureLoader callbacks no-op
      markImagineNodeReleased(mat as THREE.ShaderMaterial);
      disposeImagineNodeOwnedMaps(mat as THREE.ShaderMaterial);
    }
    if ((mat as THREE.ShaderMaterial).name === "LorePlaqueMaterial") {
      disposeLorePlaqueOwnedAtlas(mat as THREE.ShaderMaterial);
    }
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

/**
 * HACKER (c9): estimate total texture bytes across paper/star/sky/lore atlases/
 * Imagine owned downscales. Reports overBudget vs kit.textureBudgetBytes.
 * Does not fabricate dims — unknown sizes contribute 0.
 */
export function painterlyKitTextureBudget(kit: PainterlyKit): PainterlyTextureBudgetReport {
  const items: PainterlyTextureBudgetReport["items"] = [];
  let bytes = 0;
  bytes += pushBudgetItem(items, "paperGrain", kit.paperGrainTexture);
  bytes += pushBudgetItem(items, "starSprite", kit.starSpriteTexture);
  for (let i = 0; i < kit.trackedSkies.length; i++) {
    bytes += pushBudgetItem(items, `sky[${i}]`, kit.trackedSkies[i]!.map);
  }
  for (let i = 0; i < kit.tracked.length; i++) {
    const m = kit.tracked[i]!;
    if (m.name === "ImagineNodeMaterial") {
      const owned = (m.userData as Record<string, unknown>).imagineOwnedMap as THREE.Texture | null;
      const img = (m.uniforms?.["uImage"]?.value as THREE.Texture | null) ?? null;
      bytes += pushBudgetItem(items, `imagineOwned[${i}]`, owned);
      if (img && img !== owned && img !== kit.paperGrainTexture) {
        bytes += pushBudgetItem(items, `imagineImage[${i}]`, img);
      }
    }
    if (m.name === "LorePlaqueMaterial") {
      const atlas = (m.userData as Record<string, unknown>).loreOwnedAtlas as
        | { texture?: THREE.Texture }
        | THREE.Texture
        | null
        | undefined;
      const tex =
        atlas && typeof atlas === "object" && "texture" in atlas
          ? (atlas.texture as THREE.Texture | undefined)
          : atlas && (atlas as THREE.Texture).isTexture
            ? (atlas as THREE.Texture)
            : (m.uniforms?.["uTextMap"]?.value as THREE.Texture | null);
      bytes += pushBudgetItem(items, `loreAtlas[${i}]`, tex ?? null);
      const parch = m.uniforms?.["uPaperMap"]?.value as THREE.Texture | null;
      if (parch && parch !== kit.paperGrainTexture) {
        bytes += pushBudgetItem(items, `loreParchment[${i}]`, parch);
      }
    }
  }
  const budget = kit.textureBudgetBytes ?? PAINTER_TEXTURE_BUDGET_BYTES;
  return {
    bytes,
    budget,
    overBudget: bytes > budget,
    remaining: Math.max(0, budget - bytes),
    items,
  };
}

/** Pure helper for tests: count outstanding disposables before/after dispose. */
export function painterlyKitResourceCounts(kit: PainterlyKit): {
  materials: number;
  skies: number;
  bindings: number;
  disposed: boolean;
} {
  return {
    materials: kit.tracked.length,
    skies: kit.trackedSkies.length,
    bindings: kit.textureBindings.length,
    disposed: kit.disposed,
  };
}

/**
 * WebGL context loss/restore: pause ticks on loss; on restore recreate CPU textures
 * that hold canvas/data uploads (star sprite + paper grain) and REBIND consumers
 * so surfaces do not go blank. Does not silently swallow errors.
 */
export function attachPainterlyContextHandlers(
  canvas: HTMLCanvasElement,
  kit: PainterlyKit,
  rebuild?: () => void,
): () => void {
  // HACKER (c7): StrictMode / double-attach — detach previous listeners for this kit first
  if (kit.detachContext) {
    try {
      kit.detachContext();
    } catch {
      /* */
    }
    kit.detachContext = null;
  }
  const onLost = (ev: Event) => {
    ev.preventDefault();
    kit.contextLost = true;
  };
  const onRestored = () => {
    if (kit.disposed) return;
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
    // HACKER FIX (c4): re-attach new texture objects to every consumer
    rebindPainterlyKitTextures(kit);
    try {
      rebuild?.();
    } catch (err) {
      kit.lastTickError = err instanceof Error ? err.message : String(err);
    }
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    canvas.removeEventListener("webglcontextlost", onLost, false);
    canvas.removeEventListener("webglcontextrestored", onRestored, false);
    if (kit.detachContext === detach) kit.detachContext = null;
  };
  kit.detachContext = detach;
  return detach;
}

export function usePainterlyKitFactory() {
  return {
    createPainterlyKit,
    tickPainterlyKit,
    disposePainterlyKit,
    disposeAllPainterlyKits,
    livePainterlyKitCount,
    attachPainterlyContextHandlers,
    rebindPainterlyKitTextures,
    painterlyKitResourceCounts,
    releasePainterlyMaterial,
  };
}
