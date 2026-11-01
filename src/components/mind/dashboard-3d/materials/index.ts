/** Painter lane materials registry. */
export const PAINTER_MATERIALS = {
  starWatercolor: "StarWatercolorMaterial",
  buildingBrush: "BuildingBrushMaterial",
  lorePlaque: "LorePlaqueMaterial",
  inkWashEdge: "InkWashEdgeMaterial",
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
  clampTextureSizeToGpu,
  sanitizeFinite,
  sanitizeShaderTime,
  PAINTER_TIME_PERIOD,
  PAPER_GRAIN_MIN_SIZE,
  PAPER_GRAIN_MAX_SIZE,
  GPU_SAFE_TEXTURE_DEFAULT,
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
  createParchmentTextureForGpu,
  sanitizeLoreNotes,
  LORE_MAX_NOTES,
  LORE_MAX_CHARS_PER_NOTE,
  type LorePlaqueOptions,
  type LoreNote,
} from "./lore-plaque.ts";
export {
  createInkWashEdgeMaterial,
  tickInkWashEdgeMaterial,
  setInkWashEdgeHealth,
  buildInkWashRibbon,
  INK_RIBBON_MAX_SEGMENTS,
  type InkWashRibbonOptions,
  sanitizeHealthToneArray,
  HEALTH_RGB,
  type InkWashEdgeOptions,
  type HealthTone,
} from "./ink-wash-edge.ts";
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
  releasePainterlyMaterial,
  usePainterlyKitFactory,
  type PainterlyKit,
  type PainterlyKitOptions,
} from "./use-painterly-kit.ts";
