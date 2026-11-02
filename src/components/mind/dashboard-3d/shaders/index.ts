/** Painter lane shader registry. */
export const PAINTER_SHADERS = {
  painterlyPass: "PainterlyPassShader",
  watercolorStar: "WatercolorStarShader",
  brushBuilding: "BrushBuildingShader",
  lorePlaque: "LorePlaqueShader",
  inkWashEdge: "InkWashEdgeShader",
  imagineNode: "ImagineNodeShader",
  laneNebula: "LaneNebulaShader",
  cityGround: "CityGroundMaterial",
} as const;

export {
  GLSL_HASH_NOISE,
  GLSL_MEDIUMP_GUARD,
  PAINTER_SHADER_VERSION,
  PAINTER_SHADER_PRECISION,
} from "./glsl-noise.ts";
export {
  PainterlyPassShader,
  PainterlyPassFallbackShader,
  createPainterlyPass,
  tickPainterlyPass,
  disposePainterlyPass,
  resizePainterlyPass,
  flushPainterlyPassResize,
  safePainterlyPassSize,
  painterlyAmountFromHealth,
  setPainterlyPassHealth,
  setPainterlyPassAmount,
  setPainterlyPassFiber,
  sanitizePainterlyPassUniforms,
  painterlyFiberFromAmount,
  painterlyPassResizeStats,
  PAINTER_PASS_MAX_EDGE,
  PAINTER_PASS_MAX_DPR,
  PAINTER_AMOUNT_MIN,
  PAINTER_AMOUNT_MAX,
  PAINTER_AMOUNT_DEFAULT,
  PAINTER_FIBER_DEFAULT,
  PAINTER_FIBER_MIN,
  PAINTER_FIBER_MAX,
  PAINTER_RESIZE_MIN_INTERVAL_MS,
  type PainterlyPassOptions,
  type PainterlyPassSize,
  type PainterlyHealthInputs,
} from "./painterly-pass.ts";
export { WatercolorStarShader } from "./watercolor-star.ts";
export { BrushBuildingShader } from "./brush-building.ts";
export { LorePlaqueShader } from "./lore-plaque.ts";
export { InkWashEdgeShader } from "./ink-wash-edge.ts";
export { ImagineNodeShader } from "./imagine-node.ts";
export { CityGroundShader } from "./city-ground.ts";
export { LaneNebulaShader } from "./lane-nebula.ts";
