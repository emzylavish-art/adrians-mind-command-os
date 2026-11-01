import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { sunScreenUv } from "./god-rays.ts";
import { measureLuminance, type LuminanceStats } from "./backdrop-meter.ts";
import { contrastRatio } from "./wcag-contrast.ts";

/**
 * Imagine card edge separation (light lane, queue #93; builds on #84 probe).
 *
 * When the focused Imagine card and the nebula right around it have nearly
 * the same luminance (measured card-vs-surround ratio under EDGE_SEP_RATIO),
 * the card "melts" into the backdrop. This screen-space pass draws a thin,
 * cool, health-neutral rim just outside the card's projected bounds — a light
 * rim over a dark surround, a soft shade halo over a bright one — with a
 * strength taken ONLY from the real measured ratio.
 *
 * Measurement: with `detailDim.setCardSurround(true)` the #84 card probe slot
 * is read at CARD_SURROUND_SCALE× the card radius, and its existing 8×8 block
 * is split into the card core (texel centres ≤ CARD_CORE_R radii) and the
 * surround ring (≥ CARD_RING_MIN_R radii). Same slot, same readback — cost
 * unchanged. Clamped at the canvas edge → no split → no surround reading.
 *
 * Honesty: no card reading / no surround / junk / no real radius → gain 0,
 * pass disabled (byte-identical frame). Reduced motion snaps.
 */

/** Below this card-vs-surround contrast ratio the card gets a rim. */
export const EDGE_SEP_RATIO = 1.5;
/** Ratio at/below which the rim is at full strength. */
export const EDGE_SEP_FULL = 1.05;
export const EDGE_MAX = 0.32;
export const EDGE_EASE_MS = 260;
/** Rim band: starts at EDGE_INNER radii, fades over EDGE_WIDTH radii. */
export const EDGE_INNER = 1.0;
export const EDGE_WIDTH = 0.14;
/** Max(card, surround) mean above which a shade halo is used instead of a light rim. */
export const EDGE_SHADE_ABOVE = 0.35;
/** Cool, health-neutral rim colour (encoded sRGB). */
export const EDGE_COLOR: readonly [number, number, number] = [0.62, 0.78, 1.0];
/** Probe half-extent (in card radii) when the surround split is on. */
export const CARD_SURROUND_SCALE = 1.5;
/** Texel centres within this many radii count as the card core. */
export const CARD_CORE_R = 0.6;
/** Texel centres at/beyond this many radii count as the surround ring. */
export const CARD_RING_MIN_R = 1.2;

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export type ProbeSplit = { core: LuminanceStats; ring: LuminanceStats };

/**
 * Split an RGBA block (edge×edge, covering ±scale card radii, square in card
 * units) into core and ring stats by texel-centre distance. Junk → null.
 */
export function splitProbeBlock(
  data: ArrayLike<number> | null | undefined,
  edge: number,
  scale = CARD_SURROUND_SCALE,
  opts: { normalized?: boolean } = {},
): ProbeSplit | null {
  if (!data || !Number.isInteger(edge) || edge <= 0 || data.length < edge * edge * 4) return null;
  if (!Number.isFinite(scale) || scale <= CARD_RING_MIN_R) return null; // no ring possible
  const core: number[] = [];
  const ring: number[] = [];
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const dx = (((x + 0.5) / edge) * 2 - 1) * scale;
      const dy = (((y + 0.5) / edge) * 2 - 1) * scale;
      const d = Math.hypot(dx, dy);
      const i = (y * edge + x) * 4;
      const px = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (d <= CARD_CORE_R) core.push(...px);
      else if (d >= CARD_RING_MIN_R) ring.push(...px);
    }
  }
  const c = measureLuminance(core, core.length / 4, 1, opts);
  const r = measureLuminance(ring, ring.length / 4, 1, opts);
  return c && r ? { core: c, ring: r } : null;
}

/** Measured card-vs-surround contrast (WCAG formula on mean luminance). Junk → null. */
export function cardSurroundRatio(
  card: LuminanceStats | null | undefined,
  surround: LuminanceStats | null | undefined,
): number | null {
  if (!card || !surround || !(card.samples > 0) || !(surround.samples > 0)) return null;
  if (!Number.isFinite(card.mean) || !Number.isFinite(surround.mean) || card.mean < 0 || surround.mean < 0) return null;
  return contrastRatio(card.mean, surround.mean);
}

/** Rim gain from a measured ratio: null / ≥ EDGE_SEP_RATIO → 0, ≤ EDGE_SEP_FULL → EDGE_MAX. */
export function edgeSeparationGain(ratio: number | null | undefined): number {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 1) return 0;
  return EDGE_MAX * smooth01((EDGE_SEP_RATIO - ratio) / (EDGE_SEP_RATIO - EDGE_SEP_FULL));
}

/** JS mirror of the shader rim band at distance d (uv, aspect-corrected) for radius r. */
export function edgeRimBand(d: number, r: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(r) || r <= 0) return 0;
  const a = r * EDGE_INNER;
  const w = r * EDGE_WIDTH;
  const rise = smooth01((d - (a - w * 0.25)) / (w * 0.25));
  const fall = 1 - smooth01((d - a) / w);
  return Math.max(0, rise * fall);
}

export type EdgeMode = "light" | "shade";

/** JS mirror of the shader's per-pixel output for one channel set (encoded 0..1). */
export function edgeApply(rgb: readonly [number, number, number], band: number, gain: number, mode: EdgeMode): [number, number, number] {
  const g = Math.min(EDGE_MAX, Math.max(0, Number.isFinite(gain) ? gain : 0));
  const b = Math.min(1, Math.max(0, Number.isFinite(band) ? band : 0));
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (mode === "shade") return rgb.map((c) => c * (1 - g * b)) as [number, number, number];
  // Additive cool light, headroom-weighted so highlights never clip.
  return rgb.map((c, i) => Math.min(1, c + EDGE_COLOR[i]! * g * b * (1 - l))) as [number, number, number];
}

export const CardEdgeShader = {
  name: "CardEdgeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    center: { value: new THREE.Vector2(0.5, 0.5) },
    radius: { value: 0.1 },
    aspect: { value: 1 },
    gain: { value: 0 },
    shade: { value: 0 },
    rimColor: { value: new THREE.Vector3(EDGE_COLOR[0], EDGE_COLOR[1], EDGE_COLOR[2]) },
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
    uniform float shade;
    uniform vec3 rimColor;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float d = length((vUv - center) * vec2(aspect, 1.0));
      float a = radius * ${EDGE_INNER.toFixed(3)};
      float w = max(radius * ${EDGE_WIDTH.toFixed(3)}, 1e-5);
      float band = smoothstep(a - w * 0.25, a, d) * (1.0 - smoothstep(a, a + w, d));
      float l = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 lit = min(tex.rgb + rimColor * gain * band * (1.0 - l), vec3(1.0));
      vec3 shaded = tex.rgb * (1.0 - gain * band);
      gl_FragColor = vec4(mix(lit, shaded, shade), tex.a);
    }
  `,
};

type EdgeUniforms = {
  [K in keyof typeof CardEdgeShader.uniforms]: { value: (typeof CardEdgeShader.uniforms)[K]["value"] };
};

export type CardEdgeReport = {
  /** "measured": rim from a fresh card + surround reading; "none": no rim. */
  source: "measured" | "none";
  /** Real measured card-vs-surround ratio, or null (no reading). */
  ratio: number | null;
  targetGain: number;
  gain: number;
  mode: EdgeMode | null;
};

export type CardEdgeHandle = {
  pass: ShaderPass;
  /** Focused card world pos + REAL projected radius (projectedRadiusUv); null / junk radius → no rim. */
  setFocus: (world: THREE.Vector3 | null, camera: THREE.Camera | null, radiusUv?: number | null) => void;
  /** The dim's `contrast.card` (needs setCardProbe(true) + setCardSurround(true)); null → no rim. */
  setSeparation: (
    card: { stats: LuminanceStats; surround?: LuminanceStats | null } | null | undefined,
    opts?: { reducedMotion?: boolean },
  ) => void;
  readonly report: CardEdgeReport;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createCardEdgePass(): CardEdgeHandle {
  const pass = new ShaderPass(CardEdgeShader);
  const u = pass.uniforms as unknown as EdgeUniforms;
  u.center.value = new THREE.Vector2(0.5, 0.5);
  u.rimColor.value = new THREE.Vector3(EDGE_COLOR[0], EDGE_COLOR[1], EDGE_COLOR[2]);
  let disposed = false;
  let focused = false;
  let targetGain = 0;
  let gain = 0;
  let ratio: number | null = null;
  let mode: EdgeMode | null = null;
  let reduced = false;

  const apply = () => {
    u.gain.value = disposed ? 0 : gain;
    u.shade.value = mode === "shade" ? 1 : 0;
    pass.enabled = !disposed && gain > 0.001;
  };
  apply();

  return {
    pass,
    setFocus(world, camera, radiusUv) {
      if (disposed) return;
      const r = typeof radiusUv === "number" && Number.isFinite(radiusUv) && radiusUv > 0 ? radiusUv : null;
      if (!world || !camera || r === null || ![world.x, world.y, world.z].every(Number.isFinite)) {
        focused = false;
        return;
      }
      camera.updateMatrixWorld();
      const s = sunScreenUv(world, camera);
      if (!s.visible) {
        focused = false;
        return;
      }
      const cam = camera as THREE.PerspectiveCamera;
      u.aspect.value = cam.isPerspectiveCamera && Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 1;
      u.radius.value = Math.min(1, r);
      u.center.value.set(s.uv[0], s.uv[1]);
      focused = true;
    },
    setSeparation(card, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      const rr = focused && card ? cardSurroundRatio(card.stats, card.surround ?? null) : null;
      ratio = rr;
      targetGain = edgeSeparationGain(rr);
      if (targetGain > 0 && card && card.surround) {
        // Mode only changes on a real reading; while fading out keep the last one.
        mode = Math.max(card.stats.mean, card.surround.mean) > EDGE_SHADE_ABOVE ? "shade" : "light";
      }
      if (reduced) {
        gain = targetGain;
        apply();
      }
    },
    get report() {
      return {
        source: (targetGain > 0 ? "measured" : "none") as CardEdgeReport["source"],
        ratio,
        targetGain,
        gain: disposed ? 0 : gain,
        mode: targetGain > 0 ? mode : null,
      };
    },
    tick(dtMs) {
      if (disposed) return;
      if (!focused) {
        targetGain = 0;
        ratio = null;
      }
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced) gain = targetGain;
      else gain += (targetGain - gain) * (1 - Math.exp(-dt / EDGE_EASE_MS));
      if (Math.abs(gain - targetGain) < 1e-4) gain = targetGain;
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gain = 0;
      targetGain = 0;
      ratio = null;
      apply();
      pass.dispose();
    },
  };
}
