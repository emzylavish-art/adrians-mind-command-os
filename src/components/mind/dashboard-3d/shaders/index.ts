/** Painter lane shader registry. */
export const PAINTER_SHADERS = {
  painterlyPass: "PainterlyPassShader",
  watercolorStar: "WatercolorStarShader",
  brushBuilding: "BrushBuildingShader",
  lorePlaque: "LorePlaqueShader",
  inkWashEdge: "InkWashEdgeShader",
  imagineNode: "ImagineNodeShader",
  laneNebula: "LaneNebulaShader",
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
  safePainterlyPassSize,
  painterlyAmountFromHealth,
  setPainterlyPassHealth,
  setPainterlyPassAmount,
  painterlyPassResizeStats,
  PAINTER_PASS_MAX_EDGE,
  PAINTER_PASS_MAX_DPR,
  PAINTER_AMOUNT_MIN,
  PAINTER_AMOUNT_MAX,
  PAINTER_AMOUNT_DEFAULT,
  type PainterlyPassOptions,
  type PainterlyPassSize,
  type PainterlyHealthInputs,
} from "./painterly-pass.ts";
export { WatercolorStarShader } from "./watercolor-star.ts";
export { BrushBuildingShader } from "./brush-building.ts";
export { LorePlaqueShader } from "./lore-plaque.ts";
export { InkWashEdgeShader } from "./ink-wash-edge.ts";
export { ImagineNodeShader } from "./imagine-node.ts";
export { LaneNebulaShader } from "./lane-nebula.ts";
