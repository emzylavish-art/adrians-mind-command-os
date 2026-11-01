import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { clampGuardRadius } from "./focus-bloom-guard.ts";
import { sunScreenUv } from "./god-rays.ts";
import {
  METER_EDGE,
  createBackdropMeter,
  createRegionReader,
  measureLuminance,
  rectsKey,
  type LuminanceStats,
  type MeterBackoff,
  type RegionReader,
} from "./backdrop-meter.ts";
import { WCAG_GRAPHIC_AA, WCAG_TEXT_AA, dimForContrast, linearToSrgb, type ContrastPlan, type Rgb } from "./wcag-contrast.ts";

/**
 * Detail-card backdrop dim (light lane, queue #60; builds on #57 radial mask).
 *
 * Screen-space pass that darkens ONLY bright backdrop pixels behind the DOM
 * detail card and/or chart rect (CSS-pixel rects passed in by Dashboard Bot),
 * so chart lines and node detail keep contrast over bright nebula. Dark pixels
 * are left alone (luminance-weighted), edges are feathered, and an optional
 * "hole" around the focused node (projectedRadiusUv, as in #57) keeps the
 * focused Imagine portrait undimmed when it sits under the card.
 *
 * Zero rects / junk rects / zero canvas → pass disabled (byte-identical frame).
 * Eases in/out; reduced motion snaps (static). Rect maths is CSS-pixel based,
 * so DPR / resize never shifts the mask (re-call setRects on resize/scroll).
 */

export const DIM_EASE_MS = 220;
/** Max darkening of the brightest backdrop pixels inside the rect. */
export const DIM_MAX = 0.5;
/** Feather + padding around each rect, CSS px. */
export const DIM_FEATHER_PX = 28;
export const DIM_PAD_PX = 10;
/** Luminance window: below LO untouched, above HI fully dimmed. */
export const DIM_LUM_LO = 0.12;
export const DIM_LUM_HI = 0.55;
export const DIM_MAX_RECTS = 2;
/**
 * Hacker (cycle after #83): caller rect lists (and index-aligned contrast
 * targets) may be longer than DIM_MAX_RECTS before junk rects are dropped.
 */
export const DIM_MAX_CALLER_RECTS = 8;
/**
 * #84: meter slots — the DIM_MAX_RECTS panel rects + one probe on the focused
 * Imagine card's own projected bounds (measured, never dimmed).
 */
export const METER_SLOTS = DIM_MAX_RECTS + 1;
/** #84: card probe half-extent as a multiple of the projected card radius. */
export const CARD_PROBE_SCALE = 1;

/**
 * #84: focused card's projected bounds as a UV rect (centre uv, radius in v
 * units, aspect = canvas w/h so u half-extent = r/aspect). Clamped to the
 * canvas; junk / off-canvas / zero area → null.
 */
export function cardProbeRect(
  centerUv: readonly [number, number] | null | undefined,
  radiusUv: number | null | undefined,
  aspect: number,
  scale = CARD_PROBE_SCALE,
): UvRect | null {
  if (!centerUv || !Number.isFinite(radiusUv) || !(radiusUv! > 0) || !Number.isFinite(aspect) || aspect <= 0) return null;
  const [cu, cv] = centerUv;
  if (!Number.isFinite(cu) || !Number.isFinite(cv) || !Number.isFinite(scale) || scale <= 0) return null;
  const hv = radiusUv! * scale;
  const hu = hv / aspect;
  const u0 = Math.max(0, cu - hu);
  const u1 = Math.min(1, cu + hu);
  const v0 = Math.max(0, cv - hv);
  const v1 = Math.min(1, cv + hv);
  if (!(u1 > u0) || !(v1 > v0)) return null;
  return [u0, v0, u1, v1];
}

const insideUv = (p: readonly [number, number], r: UvRect) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];

/** #84: real luminance of the focused card's own projected rect. */
export type CardMeasurement = { stats: LuminanceStats; rect: UvRect; atMs: number };
/** #68: measured mode may dim harder than the static window when WCAG needs it. */
export const DIM_MEASURED_MAX = 0.7;
/** Time constant for easing between static / measured strengths. */
export const DIM_MEASURE_EASE_MS = 180;

/** #68 contrast target: the DOM text colour (and card background) to protect. */
export type ContrastTarget = {
  /** Text / chart-line colour, encoded sRGB 0..1 (parseCssColor(getComputedStyle(el).color).rgb). */
  textRgb: Rgb;
  /** Card background colour + alpha (parseCssColor(...backgroundColor)); omit for bare text. */
  cardRgb?: Rgb | null;
  cardAlpha?: number | null;
  /** Ratio to reach (default WCAG_TEXT_AA 4.5 — chart tick labels are text too). */
  target?: number;
  /**
   * #69: non-text graphics in the same rect (chart lines, axes) — colour +
   * ratio (default WCAG_GRAPHIC_AA 3:1). The rect's dim is the larger of the
   * text plan and the line plan, both from the same measured stats.
   */
  lines?: { rgb: Rgb; target?: number } | null;
};

/**
 * #69: one target for every rect, or one per rect (index-aligned with the
 * rects passed to setRects; a null entry keeps that rect on the static dim).
 */
export type ContrastTargets = ContrastTarget | readonly (ContrastTarget | null | undefined)[];

export type ContrastReport = {
  /** "measured": dim from a fresh readback; "static": #67 fixed dim (no/old/failed measurement). */
  source: "measured" | "static";
  plan: ContrastPlan | null;
  /** Worst-case (p90) backdrop luminance under the rects, or null. */
  backdropLum: number | null;
  perRect: LuminanceStats[];
  measuredAtMs: number | null;
  lastError: string | null;
  reads: number;
  /** #69: plan per rect (null = that rect on static dim). */
  perRectPlans: (ContrastPlan | null)[];
  /** #69: full (pre-ease) shader strength per rect. */
  perRectStrength: number[];
  /** #80: meter readback cost back-off (real begin→resolve timings). */
  backoff: MeterBackoff;
  /**
   * Hacker (cycle after #83): caller index (into the list given to setRects /
   * setContrastTarget) of each ACTIVE rect. perRect / perRectPlans /
   * perRectStrength are indexed by active rect; junk / off-canvas / zero-area
   * caller rects are dropped, so active ≠ caller index in general.
   */
  rectSource: number[];
  /** #84: card probe opted in (setCardProbe(true)). */
  cardProbe: boolean;
  /**
   * #84: fresh reading of the focused card's own rect (null: probe off, no
   * focus, no/stale/failed read, or focus moved to another card).
   */
  card: CardMeasurement | null;
};

/**
 * Shader strength that makes the worst-case backdrop pixel (encoded grey of
 * `backdropLum`) receive exactly `dim`: the shader scales dim by its own
 * luminance window, so compensate (capped).
 */
export function measuredStrength(dim: number, backdropLum: number, cap = DIM_MEASURED_MAX): number {
  if (!Number.isFinite(dim) || !Number.isFinite(backdropLum) || dim <= 0) return 0;
  const g = linearToSrgb(backdropLum);
  const bright = smooth01((g - DIM_LUM_LO) / (DIM_LUM_HI - DIM_LUM_LO));
  if (bright <= 1e-3) return 0; // window wouldn't touch these pixels anyway
  return Math.min(cap, dim / bright);
}

export type RectLike = { left: number; top: number; width: number; height: number };
export type ViewportLike = { left?: number; top?: number; width: number; height: number };

/** UV rect: [minU, minV, maxU, maxV] (v up, GL convention). */
export type UvRect = [number, number, number, number];

/**
 * CSS-pixel rect (e.g. card.getBoundingClientRect()) → canvas UV rect, padded
 * by DIM_PAD_PX and clamped to the canvas. `viewport` is the canvas client
 * rect (left/top default 0). Junk / off-canvas / zero area → null.
 */
export function rectToUv(rect: RectLike | null | undefined, viewport: ViewportLike, pad = DIM_PAD_PX): UvRect | null {
  if (!rect || !viewport) return null;
  const vl = viewport.left ?? 0;
  const vt = viewport.top ?? 0;
  const vals = [rect.left, rect.top, rect.width, rect.height, vl, vt, viewport.width, viewport.height, pad];
  if (!vals.every(Number.isFinite)) return null;
  if (viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const x0 = (rect.left - vl - pad) / viewport.width;
  const x1 = (rect.left - vl + rect.width + pad) / viewport.width;
  const yTop = (rect.top - vt - pad) / viewport.height;
  const yBot = (rect.top - vt + rect.height + pad) / viewport.height;
  const u0 = Math.max(0, x0);
  const u1 = Math.min(1, x1);
  const v0 = Math.max(0, 1 - yBot);
  const v1 = Math.min(1, 1 - yTop);
  if (!(u1 > u0) || !(v1 > v0)) return null;
  return [u0, v0, u1, v1];
}

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** JS mirror of the shader rect mask (1 inside, feathered to 0). featherUv per axis. */
export function rectMask(u: number, v: number, r: UvRect, featherU: number, featherV: number): number {
  if (![u, v, featherU, featherV, ...r].every(Number.isFinite)) return 0;
  const dx = Math.max(r[0] - u, 0, u - r[2]);
  const dy = Math.max(r[1] - v, 0, v - r[3]);
  const mx = featherU > 0 ? 1 - smooth01(dx / featherU) : dx > 0 ? 0 : 1;
  const my = featherV > 0 ? 1 - smooth01(dy / featherV) : dy > 0 ? 0 : 1;
  return mx * my;
}

/** JS mirror of the per-pixel dim factor (multiplier on rgb). Junk → 1 (no change). */
export function dimFactor(luminance: number, mask: number, strength: number): number {
  if (![luminance, mask, strength].every(Number.isFinite)) return 1;
  const s = Math.min(1, Math.max(0, strength));
  const m = Math.min(1, Math.max(0, mask));
  const bright = smooth01((luminance - DIM_LUM_LO) / (DIM_LUM_HI - DIM_LUM_LO));
  return 1 - s * m * bright;
}

export const DetailBackdropDimShader = {
  name: "DetailBackdropDimShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    rects: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] },
    rectCount: { value: 0 },
    feather: { value: new THREE.Vector2(0.02, 0.02) },
    strength: { value: 0 },
    rectWeight: { value: [1, 1] as number[] },
    lumLo: { value: DIM_LUM_LO },
    lumHi: { value: DIM_LUM_HI },
    holeUv: { value: new THREE.Vector2(0.5, 0.5) },
    holeRadius: { value: 0 },
    aspect: { value: 1 },
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
    uniform vec4 rects[${DIM_MAX_RECTS}];
    uniform int rectCount;
    uniform vec2 feather;
    uniform float strength;
    uniform float rectWeight[${DIM_MAX_RECTS}];
    uniform float lumLo;
    uniform float lumHi;
    uniform vec2 holeUv;
    uniform float holeRadius;
    uniform float aspect;
    varying vec2 vUv;

    float rectMask(vec4 r) {
      vec2 d = max(max(r.xy - vUv, vec2(0.0)), vUv - r.zw);
      vec2 m = 1.0 - smoothstep(vec2(0.0), max(feather, vec2(1e-5)), d);
      return m.x * m.y;
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float mask = 0.0;
      for (int i = 0; i < ${DIM_MAX_RECTS}; i++) {
        if (i < rectCount) mask = max(mask, rectMask(rects[i]) * rectWeight[i]);
      }
      if (holeRadius > 0.0) {
        float d = length((vUv - holeUv) * vec2(aspect, 1.0));
        mask *= smoothstep(holeRadius, holeRadius * 1.6, d);
      }
      float l = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
      float bright = smoothstep(lumLo, lumHi, l);
      gl_FragColor = vec4(tex.rgb * (1.0 - strength * mask * bright), tex.a);
    }
  `,
};

type DimUniforms = {
  [K in keyof typeof DetailBackdropDimShader.uniforms]: {
    value: (typeof DetailBackdropDimShader.uniforms)[K]["value"];
  };
};

export type DetailBackdropDimHandle = {
  pass: ShaderPass;
  /** Effective strength 0..DIM_MAX (0 = pass disabled). */
  readonly strength: number;
  /** Active UV rects (empty = none). */
  readonly rects: readonly UvRect[];
  /**
   * Rects in CSS px (getBoundingClientRect) + the canvas client rect. Null /
   * empty / all-junk → fade out. Call on open/close, resize, scroll, layout.
   */
  setRects: (
    rects: readonly (RectLike | null | undefined)[] | null,
    viewport: ViewportLike,
    opts?: { reducedMotion?: boolean },
  ) => void;
  /** Keep the focused node undimmed (null clears). radiusUv from projectedRadiusUv. */
  setHole: (world: THREE.Vector3 | null, camera: THREE.Camera | null, radiusUv?: number | null) => void;
  tick: (dtMs: number) => void;
  /**
   * #68: protect this text colour with a measured backdrop dim (null → static
   * #67 dim). Measurement runs only while rects are open, tab visible.
   */
  setContrastTarget: (target: ContrastTargets | null) => void;
  /** Tab hidden → no readbacks (document.visibilityState === "hidden"). */
  setHidden: (hidden: boolean) => void;
  /** Honest state of the measured dim (for debug badges / tests). */
  readonly contrast: ContrastReport;
  /**
   * #84: also meter the focused card's own projected bounds (from setHole)
   * so the #83 key lift has a reading when no panel sits behind the card.
   * The probe is measured only (never dimmed); it refreshes at the meter's
   * #80 interval (or at once when focus moves to another card), so readback
   * cost stays under the back-off guard. Off by default.
   */
  setCardProbe: (on: boolean) => void;
  dispose: () => void;
};

export type CreateDetailBackdropDimOpts = {
  /** Injected reader (tests); default creates a GPU RegionReader lazily on first measure. */
  reader?: RegionReader | null;
  now?: () => number;
  intervalMs?: number;
};

type VisibilityDoc = {
  hidden?: unknown;
  visibilityState?: unknown;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
};
const visibilityDoc = (): VisibilityDoc | null =>
  ((globalThis as { document?: VisibilityDoc }).document ?? null);
/** True when the page is not being shown (tab hidden). Missing document → false. */
const documentHidden = (): boolean => {
  const d = visibilityDoc();
  return !!d && (d.hidden === true || d.visibilityState === "hidden");
};

const defaultNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

export function createDetailBackdropDimPass(opts: CreateDetailBackdropDimOpts = {}): DetailBackdropDimHandle {
  const pass = new ShaderPass(DetailBackdropDimShader);
  const u = pass.uniforms as unknown as DimUniforms;
  // ShaderPass clones uniforms; make vector/array values per-instance.
  u.rects.value = [new THREE.Vector4(), new THREE.Vector4()];
  u.rectWeight.value = [1, 1];
  u.feather.value = new THREE.Vector2(0.02, 0.02);
  u.holeUv.value = new THREE.Vector2(0.5, 0.5);
  let disposed = false;
  let uvRects: UvRect[] = [];
  /** Caller index of each active uvRect (targets are caller-aligned). */
  let rectSrc: number[] = [];
  /** #84 card probe: opted in, live candidate (from setHole), sticky rect being metered. */
  let probeOn = false;
  let probeCenter: [number, number] | null = null;
  let probeCandidate: UvRect | null = null;
  let probeRect: UvRect | null = null;
  let lastBeginMs = -Infinity;
  type Layout = { key: string; panelKey: string; panelCount: number; probe: UvRect | null };
  /** Layout of the latest resolved measurement (slot meaning of perRect). */
  let measuredLayout: Layout | null = null;
  let level = 0;
  let target = 0;
  let from = 0;
  let elapsed = DIM_EASE_MS;
  let reduced = false;
  const now = opts.now ?? defaultNow;
  const meter = createBackdropMeter({ intervalMs: opts.intervalMs });
  let reader: RegionReader | null = opts.reader ?? null;
  const ownReader = !opts.reader;
  /** Per-rect targets (index-aligned); null = no measured dim at all. */
  let contrastTarget: (ContrastTarget | null)[] | null = null;
  let hidden = false;
  let report: ContrastReport = {
    source: "static",
    plan: null,
    backdropLum: null,
    perRect: [],
    measuredAtMs: null,
    lastError: null,
    reads: 0,
    perRectPlans: [],
    perRectStrength: [],
    backoff: meter.backoff,
    rectSource: [],
    cardProbe: false,
    card: null,
  };

  /** Plan for one rect from its own measured stats (text, and lines if given). */
  const planFor = (t: ContrastTarget, lum: number): ContrastPlan | null => {
    const text = dimForContrast({
      textRgb: t.textRgb,
      cardRgb: t.cardRgb,
      cardAlpha: t.cardAlpha,
      target: t.target ?? WCAG_TEXT_AA,
      backdropLum: lum,
      maxDim: DIM_MEASURED_MAX,
    });
    const lines = t.lines
      ? dimForContrast({
          textRgb: t.lines.rgb,
          cardRgb: t.cardRgb,
          cardAlpha: t.cardAlpha,
          target: t.lines.target ?? WCAG_GRAPHIC_AA,
          backdropLum: lum,
          maxDim: DIM_MEASURED_MAX,
        })
      : null;
    if (!text) return lines;
    if (!lines) return text;
    // The rect needs whichever element is harder to read; report that plan.
    return lines.dim > text.dim ? lines : text;
  };

  /**
   * Full strength per rect (before ease): measured when that rect has a fresh
   * reading and a target, else static #67. #69: rects no longer share the
   * worst rect's strength — a bright nebula behind Charts doesn't over-dim the
   * Imagine scene behind the detail card.
   */
  const fullStrengths = (): number[] => {
    const panelKey = uvRects.length ? rectsKey(uvRects) : "";
    const lm = meter.latestFresh(now());
    const layout = lm && measuredLayout && measuredLayout.key === lm.key ? measuredLayout : null;
    // Panel slots apply only to the exact panel layout they were read for.
    const panelM =
      lm && layout && contrastTarget && panelKey && layout.panelKey === panelKey && layout.panelCount > 0
        ? { atMs: lm.atMs, perRect: lm.perRect.slice(0, layout.panelCount) }
        : null;
    const m = panelM;
    // #84: card slot applies while the probe is on and focus is still on the
    // card it was read for (centre inside the metered rect).
    const cardStats = layout && layout.probe && lm ? lm.perRect[layout.panelCount] ?? null : null;
    const card: CardMeasurement | null =
      probeOn && !disposed && cardStats && layout!.probe && probeCenter && insideUv(probeCenter, layout!.probe)
        ? { stats: cardStats, rect: layout!.probe, atMs: lm!.atMs }
        : null;
    const plans: (ContrastPlan | null)[] = [];
    const strengths: number[] = [];
    for (let i = 0; i < Math.max(1, uvRects.length); i++) {
      // Targets are aligned to the CALLER's list; a dropped rect must not
      // shift the next rect onto its neighbour's target (hacker, after #83).
      const t = contrastTarget?.[rectSrc[i] ?? i] ?? null;
      const st = m?.perRect[i] ?? null;
      const plan = t && st ? planFor(t, st.p90) : null;
      plans.push(plan);
      strengths.push(plan && st ? measuredStrength(plan.dim, st.p90) : DIM_MAX);
    }
    let worst = -1;
    plans.forEach((p, i) => {
      if (p && (worst < 0 || strengths[i]! > strengths[worst]!)) worst = i;
    });
    const anyMeasured = worst >= 0;
    report = {
      source: anyMeasured ? "measured" : "static",
      plan: anyMeasured ? plans[worst]! : null,
      backdropLum: anyMeasured && m ? m.perRect[worst]!.p90 : null,
      perRect: m ? m.perRect : [],
      measuredAtMs: m ? m.atMs : null,
      lastError: meter.lastError,
      reads: meter.reads,
      perRectPlans: plans,
      perRectStrength: strengths,
      backoff: meter.backoff,
      rectSource: rectSrc.slice(),
      cardProbe: probeOn && !disposed,
      card,
    };
    return strengths;
  };

  const panelMeasuring = () => !disposed && !!contrastTarget && !hidden && uvRects.length > 0 && target > 0;
  const probeMeasuring = () => !disposed && probeOn && !hidden && !!probeCandidate;
  const measuring = () => panelMeasuring() || probeMeasuring();

  /** Eased per-rect full strengths so a new measurement never pops the dim (reduced motion snaps). */
  const curFull: number[] = [DIM_MAX, DIM_MAX];
  const apply = (dtMs?: number) => {
    const goal = fullStrengths();
    const snap = reduced || level <= 0.001;
    const k = dtMs === undefined ? 0 : 1 - Math.exp(-Math.max(0, dtMs) / DIM_MEASURE_EASE_MS);
    for (let i = 0; i < DIM_MAX_RECTS; i++) {
      const g = goal[i] ?? goal[0] ?? DIM_MAX;
      curFull[i] = snap ? g : curFull[i]! + (g - curFull[i]!) * k;
    }
    const n = Math.max(1, Math.min(DIM_MAX_RECTS, u.rectCount.value));
    const peak = Math.max(...curFull.slice(0, n));
    // Shader: strength = peak, each rect weighted by its share (≤1).
    for (let i = 0; i < DIM_MAX_RECTS; i++) u.rectWeight.value[i] = peak > 1e-6 ? curFull[i]! / peak : 0;
    u.strength.value = disposed ? 0 : peak * level;
    // While measuring keep the pass alive even at strength 0: the readback runs
    // inside its render (input buffer = undimmed backdrop, no feedback).
    // #84: the card probe alone also keeps it alive (rectCount 0 / strength 0
    // = identity output, so the frame is unchanged while it measures).
    pass.enabled =
      !disposed &&
      ((u.rectCount.value > 0 && (u.strength.value > 0.001 || (panelMeasuring() && level > 0.001))) || probeMeasuring());
  };
  apply();

  // Hacker (cycle after #80): a read still in flight when the tab hides (and
  // resolving / timing out only after resume) is excused the moment we hide.
  const vdoc = visibilityDoc();
  const onVisibility = () => {
    if (documentHidden()) meter.suspend();
  };
  if (vdoc && typeof vdoc.addEventListener === "function") vdoc.addEventListener("visibilitychange", onVisibility);

  const baseRender = pass.render.bind(pass);
  pass.render = ((renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    if (disposed) return;
    const src = (readBuffer as THREE.WebGLRenderTarget | undefined)?.texture;
    if (measuring() && src) {
      const t0 = now();
      // #84: the probe rect is sticky between reads so a drifting card can't
      // re-key (= force a read) every frame; it refreshes at the meter's
      // current (#80 back-off aware) interval, or at once on a focus change.
      if (probeMeasuring()) {
        const stale = !Number.isFinite(lastBeginMs) || t0 < lastBeginMs || t0 - lastBeginMs >= meter.backoff.intervalMs;
        if (!probeRect || stale || !probeCenter || !insideUv(probeCenter, probeRect)) probeRect = probeCandidate;
      } else probeRect = null;
      const panels = panelMeasuring() ? uvRects : [];
      const list = probeRect ? [...panels, probeRect] : panels;
      const panelKey = panels.length ? rectsKey(panels) : "";
      const key = `${panelKey}#${probeRect ? rectsKey([probeRect]) : ""}`;
      if (list.length && meter.due(t0, key, { hidden, reducedMotion: reduced })) {
        const token = meter.begin(t0, key);
        lastBeginMs = t0;
        const layout: Layout = { key, panelKey, panelCount: panels.length, probe: probeRect };
        try {
          reader ??= createRegionReader(METER_SLOTS);
          reader
            .read(renderer, src, list)
            .then((bufs) => {
              // Hacker (cycle after #80): the render loop pauses before it can
              // call setHidden(true), so a read that lands while the tab is
              // hidden must be excused here, not billed as slow-readback.
              if (hidden || documentHidden()) meter.suspend();
              meter.resolve(token, bufs.map((b) => measureLuminance(b, METER_EDGE, METER_EDGE)), now());
              const lm = meter.latestFresh(now());
              if (lm && lm.key === key) measuredLayout = layout;
            })
            .catch((e: unknown) => meter.fail(token, e));
        } catch (e) {
          meter.fail(token, e); // sync GL failure: surfaced, static dim stays
        }
      }
    }
    baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }) as typeof pass.render;

  return {
    pass,
    get strength() {
      return disposed ? 0 : u.strength.value;
    },
    get rects() {
      return uvRects;
    },
    setRects(rects, viewport, opts = {}) {
      if (disposed) return;
      reduced = !!opts.reducedMotion;
      const kept = (rects ?? [])
        .slice(0, DIM_MAX_CALLER_RECTS)
        .map((r, src) => ({ uv: viewport ? rectToUv(r, viewport) : null, src }))
        .filter((e): e is { uv: UvRect; src: number } => !!e.uv)
        .slice(0, DIM_MAX_RECTS);
      const next = kept.map((e) => e.uv);
      if (next.length) {
        // Keep the previous rects while fading out; only overwrite with real ones.
        uvRects = next;
        rectSrc = kept.map((e) => e.src);
        next.forEach((r, i) => u.rects.value[i]!.set(r[0], r[1], r[2], r[3]));
        u.rectCount.value = next.length;
        u.feather.value.set(DIM_FEATHER_PX / viewport.width, DIM_FEATHER_PX / viewport.height);
      }
      const nextTarget = next.length ? 1 : 0;
      if (nextTarget !== target) {
        from = level;
        target = nextTarget;
        elapsed = 0;
      }
      if (reduced) {
        level = target;
        elapsed = DIM_EASE_MS;
      }
      if (!next.length && level <= 0.001) {
        uvRects = [];
        rectSrc = [];
        u.rectCount.value = 0;
      }
      apply();
    },
    setHole(world, camera, radiusUv) {
      if (disposed) return;
      const clearProbe = () => {
        probeCenter = null;
        probeCandidate = null;
      };
      if (!world || !camera || ![world.x, world.y, world.z].every(Number.isFinite)) {
        u.holeRadius.value = 0;
        clearProbe();
        apply();
        return;
      }
      camera.updateMatrixWorld();
      const s = sunScreenUv(world, camera);
      if (!s.visible) {
        u.holeRadius.value = 0;
        clearProbe();
        apply();
        return;
      }
      u.holeUv.value.set(s.uv[0], s.uv[1]);
      u.holeRadius.value = clampGuardRadius(radiusUv ?? undefined);
      const cam = camera as THREE.PerspectiveCamera;
      u.aspect.value = cam.isPerspectiveCamera && Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 1;
      probeCenter = [s.uv[0], s.uv[1]];
      probeCandidate = cardProbeRect(probeCenter, u.holeRadius.value, u.aspect.value);
      apply();
    },
    setCardProbe(on) {
      if (disposed) return;
      probeOn = !!on;
      if (!probeOn) probeRect = null;
      apply();
    },
    setContrastTarget(next) {
      if (disposed) return;
      const valid = (t: ContrastTarget | null | undefined): ContrastTarget | null => {
        if (!t || !Array.isArray(t.textRgb) || t.textRgb.length < 3) return null;
        if (!t.textRgb.slice(0, 3).every((v) => Number.isFinite(v))) return null;
        const okLines =
          t.lines && Array.isArray(t.lines.rgb) && t.lines.rgb.length >= 3 && t.lines.rgb.slice(0, 3).every(Number.isFinite);
        return okLines || !t.lines ? t : { ...t, lines: null }; // junk line colour → text-only, never guessed
      };
      const list = Array.isArray(next)
        ? (next as readonly (ContrastTarget | null | undefined)[]).slice(0, DIM_MAX_CALLER_RECTS).map(valid)
        : next
          ? Array.from({ length: DIM_MAX_CALLER_RECTS }, () => valid(next as ContrastTarget))
          : [];
      contrastTarget = list.some(Boolean) ? list : null;
      if (!contrastTarget && !probeOn) meter.reset(); // #84: the card probe keeps its own readings
      apply();
    },
    setHidden(h) {
      if (disposed) return;
      hidden = !!h;
      if (hidden) meter.suspend();
      apply();
    },
    get contrast() {
      // Back-off changes when a read resolves (async), not only on apply().
      report.backoff = meter.backoff;
      return report;
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      meter.noteFrame(dt);
      if (reduced || elapsed >= DIM_EASE_MS) level = target;
      else {
        elapsed = Math.min(DIM_EASE_MS, elapsed + dt);
        level = from + (target - from) * smooth01(elapsed / DIM_EASE_MS);
      }
      if (target === 0 && level <= 0.001) {
        uvRects = [];
        rectSrc = [];
        u.rectCount.value = 0;
      }
      apply(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (vdoc && typeof vdoc.removeEventListener === "function") vdoc.removeEventListener("visibilitychange", onVisibility);
      level = 0;
      target = 0;
      uvRects = [];
      rectSrc = [];
      probeOn = false;
      probeRect = null;
      probeCandidate = null;
      probeCenter = null;
      measuredLayout = null;
      u.rectCount.value = 0;
      contrastTarget = null;
      meter.reset();
      apply();
      if (ownReader) reader?.dispose();
      reader = null;
      pass.dispose();
    },
  };
}
