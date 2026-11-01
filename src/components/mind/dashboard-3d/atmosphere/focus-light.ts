import * as THREE from "three";
import { KEY_RGB, RIM_RGB, normalizeHealthTone, type HealthTone } from "./health-tone.ts";

/**
 * Focus key + rim light (light lane, cycle "focus readability").
 *
 * When a star / Imagine portrait card is focused, a soft neutral key spot lights
 * it from the camera's upper-left and a health-tinted rim point light sits
 * behind it (away from the camera) so the silhouette separates from the
 * nebula. Key stays near-white so the Imagine artwork reads true; only the rim
 * carries health colour. Missing / unknown health → idle rim (neutral, never
 * green). No focus / non-finite positions → lights fade to 0 and hide.
 * Reduced motion snaps instead of easing.
 */

export const FOCUS_EASE_MS = 350;
export const FOCUS_KEY_INTENSITY = 12;
export const FOCUS_RIM_INTENSITY = 14;
/** Distance of key / rim from the focused node (world units). */
export const FOCUS_KEY_OFFSET = 4.2;
export const FOCUS_RIM_OFFSET = 3.0;

export type Vec3Like = readonly [number, number, number] | { x: number; y: number; z: number };

export type FocusLightInput = {
  position: Vec3Like;
  /** Camera world position — key sits camera-side, rim opposite. */
  camera: Vec3Like;
  health?: unknown;
};

export type FocusRigPlacement = {
  key: [number, number, number];
  rim: [number, number, number];
};

function toVec(v: Vec3Like | null | undefined): THREE.Vector3 | null {
  if (!v) return null;
  const [x, y, z] = Array.isArray(v)
    ? (v as readonly number[])
    : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z];
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return new THREE.Vector3(x, y, z);
}

/**
 * Key: from node toward camera, lifted and pushed to camera-left (classic 3/4
 * key). Rim: behind the node, opposite the camera, lifted. Returns null on junk
 * input (non-finite, or camera sitting on the node).
 */
export function focusRigPlacement(position: Vec3Like, camera: Vec3Like): FocusRigPlacement | null {
  const node = toVec(position);
  const cam = toVec(camera);
  if (!node || !cam) return null;
  const toCam = cam.clone().sub(node);
  if (toCam.lengthSq() < 1e-8) return null;
  toCam.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let left = new THREE.Vector3().crossVectors(up, toCam);
  if (left.lengthSq() < 1e-8) left = new THREE.Vector3(-1, 0, 0); // looking straight down
  left.normalize();
  const key = node
    .clone()
    .addScaledVector(toCam, FOCUS_KEY_OFFSET * 0.8)
    .addScaledVector(left, FOCUS_KEY_OFFSET * 0.55)
    .addScaledVector(up, FOCUS_KEY_OFFSET * 0.5);
  const rim = node
    .clone()
    .addScaledVector(toCam, -FOCUS_RIM_OFFSET)
    .addScaledVector(up, FOCUS_RIM_OFFSET * 0.6);
  return { key: key.toArray() as [number, number, number], rim: rim.toArray() as [number, number, number] };
}

/** Near-white key: 80% neutral + 20% tone key, so artwork colours read true. */
export function focusKeyRgb(health: unknown): [number, number, number] {
  const k = KEY_RGB[normalizeHealthTone(health)];
  return [0.8 + 0.2 * k[0], 0.8 + 0.2 * k[1], 0.8 + 0.2 * k[2]].map((c) => Math.min(1, c)) as [
    number,
    number,
    number,
  ];
}

export function focusRimRgb(health: unknown): [number, number, number] {
  const r = RIM_RGB[normalizeHealthTone(health)];
  return [r[0], r[1], r[2]];
}

export type FocusLightHandle = {
  key: THREE.SpotLight;
  rim: THREE.PointLight;
  /** Eased 0..1 focus level (0 = off). */
  readonly level: number;
  readonly tone: HealthTone;
  setFocus: (input: FocusLightInput | null, opts?: { reducedMotion?: boolean }) => void;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createFocusLight(scene: THREE.Scene): FocusLightHandle {
  const key = new THREE.SpotLight(0xffffff, 0, 18, Math.PI / 7, 0.65, 1.6);
  const rim = new THREE.PointLight(0xffffff, 0, 10, 1.8);
  key.visible = false;
  rim.visible = false;
  scene.add(key, rim, key.target);

  let disposed = false;
  let level = 0;
  let target = 0;
  let from = 0;
  let elapsed = FOCUS_EASE_MS;
  let reduced = false;
  let tone: HealthTone = "idle";

  const apply = () => {
    key.intensity = FOCUS_KEY_INTENSITY * level;
    rim.intensity = FOCUS_RIM_INTENSITY * level;
    const on = level > 0.001;
    key.visible = on;
    rim.visible = on;
  };

  return {
    key,
    rim,
    get level() {
      return disposed ? 0 : level;
    },
    get tone() {
      return tone;
    },
    setFocus(input, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      const place = input ? focusRigPlacement(input.position, input.camera) : null;
      const nextTarget = place ? 1 : 0;
      if (place && input) {
        tone = normalizeHealthTone(input.health);
        key.position.set(...place.key);
        rim.position.set(...place.rim);
        const node = toVec(input.position)!;
        key.target.position.copy(node);
        key.target.updateMatrixWorld();
        key.color.setRGB(...focusKeyRgb(tone));
        rim.color.setRGB(...focusRimRgb(tone));
      }
      if (nextTarget !== target) {
        from = level;
        target = nextTarget;
        elapsed = 0;
      }
      if (reduced) {
        level = target;
        elapsed = FOCUS_EASE_MS;
      }
      apply();
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced || elapsed >= FOCUS_EASE_MS) {
        level = target;
      } else {
        elapsed = Math.min(FOCUS_EASE_MS, elapsed + dt);
        const t = elapsed / FOCUS_EASE_MS;
        level = from + (target - from) * (t * t * (3 - 2 * t));
      }
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      level = 0;
      apply();
      scene.remove(key, rim, key.target);
      key.dispose();
      rim.dispose();
    },
  };
}
