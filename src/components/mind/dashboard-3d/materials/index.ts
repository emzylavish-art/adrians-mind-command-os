/** Painter lane materials registry. */
export const PAINTER_MATERIALS = {
  starWatercolor: "StarWatercolorMaterial",
  buildingBrush: "BuildingBrushMaterial",
  lorePlaque: "LorePlaqueMaterial",
  paperGrain: "PaperGrainTexture",
  parchment: "ParchmentTexture",
  nebulaSky: "NebulaSkyMaterial",
  kit: "PainterlyKit",
} as const;

export {
  paperHash,
  makePaperGrainRGBA,
  createPaperGrainTexture,
  sanitizePaperGrainSize,
  sanitizeFinite,
  PAPER_GRAIN_MIN_SIZE,
  PAPER_GRAIN_MAX_SIZE,
  type PaperGrainTextureOptions,
} from "./paper-grain.ts";
export {
  createStarWatercolorMaterial,
  createStarSpriteTexture,
  tickStarMaterial,
  type StarSurfaceOptions,
} from "./star-surface.ts";
export {
  createBuildingBrushMaterial,
  tickBuildingMaterial,
  setBuildingProgress,
  type BuildingSurfaceOptions,
} from "./building-surface.ts";
export {
  createLorePlaqueMaterial,
  tickLorePlaqueMaterial,
  makeParchmentRGBA,
  createParchmentTexture,
  type LorePlaqueOptions,
} from "./lore-plaque.ts";
export {
  createNebulaTexture,
  createNebulaSkyMaterial,
  type NebulaTextureOptions,
} from "./nebula-sky.ts";
export {
  createPainterlyKit,
  tickPainterlyKit,
  disposePainterlyKit,
  attachPainterlyContextHandlers,
  painterlyKitResourceCounts,
  usePainterlyKitFactory,
  type PainterlyKit,
  type PainterlyKitOptions,
} from "./use-painterly-kit.ts";
