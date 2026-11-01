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
