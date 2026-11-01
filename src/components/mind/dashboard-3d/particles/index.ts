/** particles/ — Cosmos Motion Bot lane (instanced dust + commit comets). */
export {
  createDustField,
  seedDustParticles,
  DUST_COUNT_DEFAULT,
  DUST_COUNT_MAX,
  type CreateDustFieldOpts,
  type DustFieldHandle,
} from "./dust-field.ts";
export {
  createCommitComets,
  COMET_MAX_DEFAULT,
  COMET_MAX_HARD,
  COMET_SEGMENTS_DEFAULT,
  COMET_SEGMENTS_MIN,
  type CommitCometsHandle,
  type CommitTrailInput,
  type CreateCommitCometsOpts,
} from "./commit-comets.ts";
export {
  createFrameBudget,
  dustDistanceFactor,
  isDocumentHidden,
  lodCount,
  LOD_FAR,
  LOD_FAR_FACTOR,
  LOD_MIN_ACTIVE,
  LOD_NEAR,
  type FrameBudget,
  type FrameBudgetOpts,
} from "./motion-lod.ts";
