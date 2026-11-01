/** atmosphere/ — Cosmos Light Bot lane (health-tinted lights + fog sync). */
export {
  AMBIENT_RGB,
  FOG_PARAMS,
  HEALTH_HEX,
  KEY_RGB,
  RIM_RGB,
  deriveFleetTone,
  isHealthTone,
  normalizeHealthTone,
  type HealthTone,
  type Rgb,
} from "./health-tone.ts";
export {
  createHealthAtmosphere,
  type CreateHealthAtmosphereOpts,
  type HealthAtmosphereHandle,
} from "./health-lights.ts";
