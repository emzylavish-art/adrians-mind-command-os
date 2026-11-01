/** Painter lane shader registry. */
export const PAINTER_SHADERS = {
  painterlyPass: "PainterlyPassShader",
  watercolorStar: "WatercolorStarShader",
  brushBuilding: "BrushBuildingShader",
  lorePlaque: "LorePlaqueShader",
  inkWashEdge: "InkWashEdgeShader",
  imagineNode: "ImagineNodeShader",
} as const;

export {
  GLSL_HASH_NOISE,
  GLSL_MEDIUMP_GUARD,
  PAINTER_SHADER_VERSION,
} from "./glsl-noise.ts";
export {
  PainterlyPassShader,
  createPainterlyPass,
  tickPainterlyPass,
  type PainterlyPassOptions,
} from "./painterly-pass.ts";
export { WatercolorStarShader } from "./watercolor-star.ts";
export { BrushBuildingShader } from "./brush-building.ts";
export { LorePlaqueShader } from "./lore-plaque.ts";
export { InkWashEdgeShader } from "./ink-wash-edge.ts";
export { ImagineNodeShader } from "./imagine-node.ts";
