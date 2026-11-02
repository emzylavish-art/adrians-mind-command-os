import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { LuminanceStats } from "./backdrop-meter.ts";
import type { ContrastReport, UvRect } from "./detail-backdrop-dim.ts";
import { linearToSrgb } from "./wcag-contrast.ts";

/**
 * Charts depth plate from the measured backdrop spread (light lane, queue #102;
 * builds on #69 per-rect stats and #79 per-panel dim).
 *
 * The #67/#79 dim only darkens BRIGHT backdrop pixels. A busy star field /
 * nebula filament behind the Charts glass can stay busy after that: tick
 * labels and sparkline strokes compete with high-frequency structure. When
 * the #69 meter reading under the Charts rect shows a large luminance spread
 * (max − mean of the 8×8 block), this pass turns the backdrop under the rect
 * into a soft "frosted plate": a small blur, highlights compressed toward the
 * measured mean, and a faint contact shadow below the panel so it sits in
 * front of the sky.
 *
 * Honesty: strength comes ONLY from the real spread of a fresh, panel-layout
 * matched reading for that caller rect. No reading / stale / rect dropped /
 * junk → strength 0 and the pass is disabled (byte-identical frame). No extra
 * readback (reuses the dim's existing per-rect stats). Reduced motion snaps.
 * Place AFTER the detail-dim pass (the meter reads the dim's input → no
 * feedback). Blur radius and feather are in CSS px via the caller viewport,
 * so high DPR / resize never changes the look.
 */

/** Spread (linear luminance, max − mean) at/below which no plate is drawn. */
export const PLATE_SPREAD_LO = 0.04;
/** Spread at/above which the plate is at full strength. */
export const PLATE_SPREAD_HI = 0.18;
export const PLATE_MAX = 0.85;
export const PLATE_EASE_MS = 240;
/** Blur tap radius in CSS px (two rings: r and 2r). */
export const PLATE_BLUR_PX = 3;
/** Rect feather in CSS px. */
export const PLATE_FEATHER_PX = 14;
/** Highlights above the measured mean are compressed by this fraction at full strength. */
export const PLATE_FLATTEN = 0.55;
/** Contact shadow: offset below the rect and its fall-off, CSS px; max darkening. */
export const PLATE_SHADOW_OFFSET_PX = 6;
export const PLATE_SHADOW_PX = 22;
export const PLATE_SHADOW_MAX = 0.22;

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Measured spread of one rect's stats (max − mean). Junk → null. */
export function plateSpread(stats: LuminanceStats | null | undefined): number | null {
  if (!stats || !(stats.samples > 0)) return null;
  const { mean, max } = stats;
  if (!Number.isFinite(mean) || !Number.isFinite(max) || mean < 0 || max < mean) return null;
  return max - mean;
}

/** Plate strength from a measured spread: null / ≤ LO → 0, ≥ HI → PLATE_MAX. */
export function plateStrengthFromSpread(spread: number | null | undefined): number {
  if (typeof spread !== "number" || !Number.isFinite(spread) || spread <= 0) return 0;
  return PLATE_MAX * smooth01((spread - PLATE_SPREAD_LO) / (PLATE_SPREAD_HI - PLATE_SPREAD_LO));
}

/**
 * Fresh per-rect stats + UV rect for the CALLER's rect index (the index in the
 * list given to dim.setRects / setContrastTarget). Uses `rectSource` so a
 * dropped detail rect never shifts Charts onto the detail card's reading.
 * perRect is empty when the reading is stale / for another layout → null.
 */
export function plateStatsFor(
  report: Pick<ContrastReport, "perRect" | "rectSource"> | null | undefined,
  rects: readonly UvRect[] | null | undefined,
  callerIndex: number | null | undefined,
): { stats: LuminanceStats; rect: UvRect } | null {
  if (!report || !rects || typeof callerIndex !== "number" || !Number.isInteger(callerIndex) || callerIndex < 0) return null;
  const src = Array.isArray(report.rectSource) ? report.rectSource : [];
  const active = src.indexOf(callerIndex);
  if (active < 0) return null;
  // perRect / rects are index-aligned only for the layout that was read.
  if (!Array.isArray(report.perRect) || report.perRect.length !== rects.length) return null;
  const stats = report.perRect[active];
  const rect = rects[active];
  if (!stats || !rect || !rect.every(Number.isFinite)) return null;
  return { stats, rect };
}

/** JS mirror of the plate rect mask (1 inside, feathered to 0 outside). */
export function plateMask(u: number, v: number, r: UvRect, featherU: number, featherV: number): number {
  if (![u, v, featherU, featherV, ...r].every(Number.isFinite)) return 0;
  const dx = Math.max(r[0] - u, 0, u - r[2]);
  const dy = Math.max(r[1] - v, 0, v - r[3]);
  const mx = featherU > 0 ? 1 - smooth01(dx / featherU) : dx > 0 ? 0 : 1;
  const my = featherV > 0 ? 1 - smooth01(dy / featherV) : dy > 0 ? 0 : 1;
  return mx * my;
}

/**
 * JS mirror of the per-pixel plate (encoded 0..1): mix toward the blurred
 * backdrop, then compress luminance above the measured mean (encoded).
 */
export function plateApply(
  rgb: readonly [number, number, number],
  blurRgb: readonly [number, number, number],
  mask: number,
  strength: number,
  meanEnc: number,
): [number, number, number] {
  const k = Math.min(1, Math.max(0, Number.isFinite(mask) ? mask : 0)) * Math.min(PLATE_MAX, Math.max(0, Number.isFinite(strength) ? strength : 0));
  const c = rgb.map((v, i) => v + (blurRgb[i]! - v) * k) as [number, number, number];
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const m = Number.isFinite(meanEnc) ? Math.max(0, meanEnc) : l;
  if (l <= m || l <= 1e-5) return c;
  const target = m + (l - m) * (1 - PLATE_FLATTEN * k);
  const f = target / l;
  return c.map((v) => v * f) as [number, number, number];
}

export const ChartsDepthPlateShader = {
  name: "ChartsDepthPlateShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    rect: { value: new THREE.Vector4(0, 0, 0, 0) },
    feather: { value: new THREE.Vector2(0.01, 0.01) },
    blurStep: { value: new THREE.Vector2(0.002, 0.003) },
    shadowOffset: { value: 0.006 },
    shadowFall: { value: 0.02 },
    strength: { value: 0 },
    meanEnc: { value: 0 },
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
    uniform vec4 rect;
    uniform vec2 feather;
    uniform vec2 blurStep;
    uniform float shadowOffset;
    uniform float shadowFall;
    uniform float strength;
    uniform float meanEnc;
    varying vec2 vUv;

    float boxMask(vec4 r, vec2 p, vec2 f) {
      vec2 d = max(max(r.xy - p, vec2(0.0)), p - r.zw);
      vec2 m = 1.0 - smoothstep(vec2(0.0), max(f, vec2(1e-5)), d);
      return m.x * m.y;
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float mask = boxMask(rect, vUv, feather);
      // Contact shadow: the rect shifted down, outside the rect only.
      vec4 sr = rect - vec4(0.0, shadowOffset, 0.0, shadowOffset);
      float shadow = boxMask(sr, vUv, vec2(shadowFall)) * (1.0 - mask);
      float k = clamp(strength, 0.0, ${PLATE_MAX.toFixed(3)});
      vec3 c = tex.rgb;
      if (mask * k > 1e-4) {
        vec3 acc = tex.rgb * 4.0;
        float w = 4.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 o = vec2(cos(a), sin(a)) * blurStep;
          acc += texture2D(tDiffuse, vUv + o).rgb * 2.0;
          acc += texture2D(tDiffuse, vUv + o * 2.0).rgb;
          w += 3.0;
        }
        vec3 blur = acc / w;
        c = mix(tex.rgb, blur, mask * k);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (l > meanEnc && l > 1e-5) {
          float t = meanEnc + (l - meanEnc) * (1.0 - ${PLATE_FLATTEN.toFixed(3)} * mask * k);
          c *= t / l;
        }
      }
      c *= 1.0 - ${PLATE_SHADOW_MAX.toFixed(3)} * (k / ${PLATE_MAX.toFixed(3)}) * shadow;
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

type PlateUniforms = {
  [K in keyof typeof ChartsDepthPlateShader.uniforms]: { value: (typeof ChartsDepthPlateShader.uniforms)[K]["value"] };
};

export type ChartsDepthPlateReport = {
  /** "measured": plate from a fresh reading under the rect; "none": no plate. */
  source: "measured" | "none";
  /** Real measured spread (max − mean, linear) or null (no reading). */
  spread: number | null;
  /** Measured mean under the rect (linear) or null. */
  mean: number | null;
  targetStrength: number;
  strength: number;
};

export type ChartsDepthPlateHandle = {
  pass: ShaderPass;
  /**
   * The dim's contrast report + active rects, the CALLER index of the Charts
   * rect (index in the list passed to dim.setRects; null / -1 when Charts is
   * not in the list) and the canvas client rect (CSS px). Call every frame
   * after dim.tick().
   */
  setPlate: (
    report: Pick<ContrastReport, "perRect" | "rectSource"> | null | undefined,
    rects: readonly UvRect[] | null | undefined,
    callerIndex: number | null | undefined,
    viewport: { width: number; height: number } | null | undefined,
    opts?: { reducedMotion?: boolean },
  ) => void;
  readonly report: ChartsDepthPlateReport;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createChartsDepthPlatePass(): ChartsDepthPlateHandle {
  const pass = new ShaderPass(ChartsDepthPlateShader);
  const u = pass.uniforms as unknown as PlateUniforms;
  // ShaderPass clones uniforms; keep vector values per-instance.
  u.rect.value = new THREE.Vector4(0, 0, 0, 0);
  u.feather.value = new THREE.Vector2(0.01, 0.01);
  u.blurStep.value = new THREE.Vector2(0.002, 0.003);
  let disposed = false;
  let target = 0;
  let strength = 0;
  let spread: number | null = null;
  let mean: number | null = null;
  let reduced = false;
  let hasRect = false;

  const apply = () => {
    u.strength.value = disposed ? 0 : strength;
    pass.enabled = !disposed && hasRect && strength > 0.001;
  };
  apply();

  return {
    pass,
    setPlate(report, rects, callerIndex, viewport, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      const vw = viewport?.width;
      const vh = viewport?.height;
      const vpOk = typeof vw === "number" && typeof vh === "number" && Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0;
      const hit = vpOk ? plateStatsFor(report, rects, callerIndex) : null;
      const s = hit ? plateSpread(hit.stats) : null;
      spread = s;
      mean = s !== null && hit ? hit.stats.mean : null;
      target = plateStrengthFromSpread(s);
      if (hit && target > 0) {
        // Only move the plate onto a real reading; while fading out keep the last rect.
        const r = hit.rect;
        u.rect.value.set(r[0], r[1], r[2], r[3]);
        u.feather.value.set(PLATE_FEATHER_PX / vw!, PLATE_FEATHER_PX / vh!);
        u.blurStep.value.set(PLATE_BLUR_PX / vw!, PLATE_BLUR_PX / vh!);
        u.shadowOffset.value = PLATE_SHADOW_OFFSET_PX / vh!;
        u.shadowFall.value = PLATE_SHADOW_PX / vh!;
        u.meanEnc.value = linearToSrgb(hit.stats.mean);
        hasRect = true;
      }
      if (reduced) {
        strength = target;
        apply();
      }
    },
    get report() {
      return {
        source: (target > 0 ? "measured" : "none") as ChartsDepthPlateReport["source"],
        spread,
        mean,
        targetStrength: target,
        strength: disposed ? 0 : strength,
      };
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced) strength = target;
      else strength += (target - strength) * (1 - Math.exp(-dt / PLATE_EASE_MS));
      if (Math.abs(strength - target) < 1e-4) strength = target;
      if (strength <= 0.001 && target === 0) hasRect = false;
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      strength = 0;
      target = 0;
      spread = null;
      mean = null;
      hasRect = false;
      apply();
      pass.dispose();
    },
  };
}
