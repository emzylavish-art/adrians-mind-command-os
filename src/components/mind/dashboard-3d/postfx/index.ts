/**
 * postfx/ — Cosmos Light Bot lane.
 * Bloom tuning + health color grade. Painterly grain stays in universe-scene.
 */
export {
  BLOOM_BY_TONE,
  BLOOM_MAX_EDGE,
  bloomParamsForTone,
  safeBloomSize,
  createTunedBloomPass,
  type BloomTuning,
  type TunedBloomHandle,
} from "./bloom-tuning.ts";
export { bloomStrengthMultiplier, bloomTier, type BloomTier, type BloomTierInput } from "./bloom-policy.ts";
export {
  CHAIN_ENCODE_MARK,
  chainDecode,
  chainEncode,
  createChainEncoder,
  patchChainFragment,
  type ChainEncoder,
} from "./bloom-hdr-chain.ts";
export {
  ColorGradeShader,
  GRADE_BY_TONE,
  colorGradeParamsForTone,
  createColorGradePass,
  type ColorGradeHandle,
  type ColorGradeTuning,
} from "./color-grade.ts";
export {
  GOD_RAY_SAMPLES,
  GodRayShader,
  createGodRayPass,
  godRayIntensity,
  linearDepthOf,
  sunScreenUv,
  type GodRayHandle,
  type GodRayInputs,
  type SunScreen,
} from "./god-rays.ts";
export {
  EXPOSURE_BY_TONE,
  EXPOSURE_EASE_MS,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  bloomThresholdFor,
  clampExposure,
  createExposureRide,
  exposureTargetFor,
  timeOfDayExposureScale,
  type ExposureRideHandle,
  type ExposureRideInputs,
  type ExposureRideState,
} from "./exposure-ride.ts";
export {
  createContextLossRecovery,
  type ContextLossCanvas,
  type ContextLossHandle,
  type CreateContextLossOpts,
  type PostfxBundle,
  type PostfxRebuildFactory,
} from "./context-loss.ts";
