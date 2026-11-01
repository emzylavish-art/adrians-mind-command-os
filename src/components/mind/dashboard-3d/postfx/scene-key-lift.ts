import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { clampGuardRadius } from "./focus-bloom-guard.ts";
import { sunScreenUv } from "./god-rays.ts";
import type { LuminanceStats } from "./backdrop-meter.ts";
import type { ContrastReport, UvRect } from "./detail-backdrop-dim.ts";

/**
 * Imagine-scene key light from the measured backdrop (light lane, queue #81→#83).
 *
 * Imagine node cards use an UNLIT ShaderMaterial (shaders/ lane), so a THREE
 * light can't reach them. Instead this screen-space pass lifts the shadows and
 * mid-tones of the focused Imagine card with a soft, directional (upper-left
 * key) falloff — but ONLY when the #79 meter has a fresh reading showing the
 * backdrop under the card is dark. Highlights are protected (no clipping).
 *
 * Honesty: no fresh measurement / focus not inside a measured rect / junk →
 * gain 0, pass disabled (byte-identical frame). Never a guessed brightness.
 * Must sit AFTER the detail-dim pass in the composer so the meter measures the
 * un-lifted backdrop (no feedback). Reduced motion snaps.
 */

export const KEY_LIFT_MAX = 0.35;
/** Backdrop mean luminance (linear) at/below which the lift is full. */
export const KEY_LIFT_DARK = 0.03;
/** Backdrop mean luminance at/above which there is no lift. */
export const KEY_LIFT_BRIGHT = 0.15;
export const KEY_LIFT_EASE_MS = 320;
/** Lift falloff radius as a multiple of the projected card radius. */
export const KEY_LIFT_RADIUS_SCALE = 1.35;
/** Key direction offset (in card radii) — light from the upper left. */
export const KEY_LIFT_OFFSET: readonly [number, number] = [-0.35, 0.35];

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Lift gain from a measured backdrop. Null / junk / bright → 0. */
export function keyLiftGain(stats: LuminanceStats | null | undefined): number {
  if (!stats || !Number.isFinite(stats.mean) || stats.mean < 0 || !(stats.samples > 0)) return 0;
  return KEY_LIFT_MAX * smooth01((KEY_LIFT_BRIGHT - stats.mean) / (KEY_LIFT_BRIGHT - KEY_LIFT_DARK));
}

/** JS mirror of the shader's per-pixel multiplier (≥1). */
export function keyLiftFactor(luminance: number, falloff: number, gain: number): number {
  if (![luminance, falloff, gain].every(Number.isFinite)) return 1;
  const g = Math.min(KEY_LIFT_MAX, Math.max(0, gain));
  const f = Math.min(1, Math.max(0, falloff));
  const shadows = 1 - smooth01((luminance - 0.35) / (0.8 - 0.35));
  return 1 + g * f * shadows;
}

/**
 * Stats of the measured rect that contains the focused card centre (uv).
 * Uses only a FRESH contrast report (perRect is empty when stale). None → null.
 */
export function statsAtFocus(
  report: Pick<ContrastReport, "perRect"> | null | undefined,
  rects: readonly UvRect[] | null | undefined,
  focusUv: readonly [number, number] | null | undefined,
): LuminanceStats | null {
  if (!report || !rects || !focusUv || !focusUv.every(Number.isFinite)) return null;
  const [u, v] = focusUv;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (u >= r[0] && u <= r[2] && v >= r[1] && v <= r[3]) return report.perRect[i] ?? null;
  }
  return null;
}

export const SceneKeyLiftShader = {
  name: "SceneKeyLiftShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    center: { value: new THREE.Vector2(0.5, 0.5) },
    radius: { value: 0.1 },
    aspect: { value: 1 },
    gain: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 center;
    uniform float radius;
    uniform float aspect;
    uniform float gain;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float d = length((vUv - center) * vec2(aspect, 1.0));
      float falloff = 1.0 - smoothstep(0.0, max(radius, 1e-4), d);
      float l = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
      float shadows = 1.0 - smoothstep(0.35, 0.8, l);
      gl_FragColor = vec4(tex.rgb * (1.0 + gain * falloff * shadows), tex.a);
    }
  `,
};

type LiftUniforms = {
  [K in keyof typeof SceneKeyLiftShader.uniforms]: { value: (typeof SceneKeyLiftShader.uniforms)[K]["value"] };
};

export type SceneKeyLiftReport = {
  /** "measured": gain from a fresh reading under the card; "none": no lift. */
  source: "measured" | "none";
  /** Target gain (pre-ease) and the live eased gain. */
  targetGain: number;
  gain: number;
  backdropMean: number | null;
};

export type SceneKeyLiftHandle = {
  pass: ShaderPass;
  /** Focused Imagine card (world pos) + projected radius uv; null clears (fades out). */
  setFocus: (world: THREE.Vector3 | null, camera: THREE.Camera | null, radiusUv?: number | null) => void;
  /** Fresh measured stats under the card (statsAtFocus(dim.contrast, dim.rects, uv)); null → no lift. */
  setBackdrop: (stats: LuminanceStats | null | undefined, opts?: { reducedMotion?: boolean }) => void;
  /** Focus centre uv when visible (feed to statsAtFocus), else null. */
  readonly focusUv: [number, number] | null;
  readonly report: SceneKeyLiftReport;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createSceneKeyLiftPass(): SceneKeyLiftHandle {
  const pass = new ShaderPass(SceneKeyLiftShader);
  const u = pass.uniforms as unknown as LiftUniforms;
  u.center.value = new THREE.Vector2(0.5, 0.5);
  let disposed = false;
  let focused = false;
  let focusUv: [number, number] | null = null;
  let targetGain = 0;
  let gain = 0;
  let reduced = false;
  let mean: number | null = null;

  const apply = () => {
    u.gain.value = disposed ? 0 : gain;
    pass.enabled = !disposed && gain > 0.001;
  };
  apply();

  return {
    pass,
    setFocus(world, camera, radiusUv) {
      if (disposed) return;
      if (!world || !camera || ![world.x, world.y, world.z].every(Number.isFinite)) {
        focused = false;
        focusUv = null;
        return;
      }
      camera.updateMatrixWorld();
      const s = sunScreenUv(world, camera);
      if (!s.visible) {
        focused = false;
        focusUv = null;
        return;
      }
      const cam = camera as THREE.PerspectiveCamera;
      const aspect = cam.isPerspectiveCamera && Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 1;
      const r = clampGuardRadius(radiusUv ?? undefined);
      focused = true;
      focusUv = [s.uv[0], s.uv[1]];
      u.aspect.value = aspect;
      u.radius.value = r * KEY_LIFT_RADIUS_SCALE;
      u.center.value.set(s.uv[0] + (KEY_LIFT_OFFSET[0] * r) / aspect, s.uv[1] + KEY_LIFT_OFFSET[1] * r);
    },
    setBackdrop(stats, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      const g = focused ? keyLiftGain(stats) : 0;
      targetGain = g;
      mean = g > 0 && stats ? stats.mean : null;
      if (reduced) {
        gain = targetGain;
        apply();
      }
    },
    get focusUv() {
      return focusUv ? ([focusUv[0], focusUv[1]] as [number, number]) : null;
    },
    get report() {
      return { source: (targetGain > 0 ? "measured" : "none") as SceneKeyLiftReport["source"], targetGain, gain: disposed ? 0 : gain, backdropMean: mean };
    },
    tick(dtMs) {
      if (disposed) return;
      if (!focused) targetGain = 0;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced) gain = targetGain;
      else gain += (targetGain - gain) * (1 - Math.exp(-dt / KEY_LIFT_EASE_MS));
      if (Math.abs(gain - targetGain) < 1e-4) gain = targetGain;
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gain = 0;
      targetGain = 0;
      apply();
      pass.dispose();
    },
  };
}
