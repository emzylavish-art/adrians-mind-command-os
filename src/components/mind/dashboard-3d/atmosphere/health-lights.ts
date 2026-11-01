import * as THREE from "three";
import {
  AMBIENT_RGB,
  FOG_PARAMS,
  KEY_RGB,
  RIM_RGB,
  type HealthTone,
} from "./health-tone.ts";

export type HealthAtmosphereHandle = {
  ambient: THREE.AmbientLight;
  key: THREE.PointLight;
  rim: THREE.PointLight;
  fog: THREE.FogExp2;
  update: (tone: HealthTone) => void;
  dispose: () => void;
};

export type CreateHealthAtmosphereOpts = {
  /** Skip attaching fog if the scene already owns FogExp2 (painted-universe). */
  attachFog?: boolean;
  /** Initial tone. */
  tone?: HealthTone;
};

/**
 * Health-tinted ambient + key + rim lights, and optional FogExp2 sync.
 * Does not create a skybox/nebula — that stays in the painter / universe lane.
 */
export function createHealthAtmosphere(
  scene: THREE.Scene,
  opts: CreateHealthAtmosphereOpts = {},
): HealthAtmosphereHandle {
  const tone0: HealthTone = opts.tone ?? "idle";
  const attachFog = opts.attachFog !== false;

  const ambient = new THREE.AmbientLight(rgbToHex(AMBIENT_RGB[tone0]), 0.55);
  const key = new THREE.PointLight(rgbToHex(KEY_RGB[tone0]), 90, 60);
  key.position.set(0, 2, 0);
  const rim = new THREE.PointLight(rgbToHex(RIM_RGB[tone0]), 40, 50);
  rim.position.set(-8, 6, 10);

  scene.add(ambient, key, rim);

  const fogParams = FOG_PARAMS[tone0];
  const fog = new THREE.FogExp2(fogParams.color, fogParams.density);
  if (attachFog) {
    scene.fog = fog;
  }

  const update = (tone: HealthTone) => {
    ambient.color.setHex(rgbToHex(AMBIENT_RGB[tone]));
    key.color.setHex(rgbToHex(KEY_RGB[tone]));
    rim.color.setHex(rgbToHex(RIM_RGB[tone]));
    // Intensity nudge: blocked feels hotter/harsher
    key.intensity = tone === "blocked" ? 110 : tone === "stalled" ? 95 : 90;
    rim.intensity = tone === "blocked" ? 55 : tone === "healthy" ? 42 : 40;
    ambient.intensity = tone === "idle" ? 0.45 : 0.55;
    const fp = FOG_PARAMS[tone];
    fog.color.setHex(fp.color);
    fog.density = fp.density;
    if (attachFog && scene.fog !== fog) {
      scene.fog = fog;
    } else if (!attachFog && scene.fog instanceof THREE.FogExp2) {
      // Sync existing universe fog without replacing ownership
      scene.fog.color.setHex(fp.color);
      scene.fog.density = fp.density;
    }
  };

  const dispose = () => {
    scene.remove(ambient, key, rim);
    ambient.dispose();
    key.dispose();
    rim.dispose();
    if (attachFog && scene.fog === fog) {
      scene.fog = null;
    }
  };

  return { ambient, key, rim, fog, update, dispose };
}

function rgbToHex([r, g, b]: readonly [number, number, number]): number {
  const R = Math.max(0, Math.min(255, Math.round(r * 255)));
  const G = Math.max(0, Math.min(255, Math.round(g * 255)));
  const B = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (R << 16) | (G << 8) | B;
}
