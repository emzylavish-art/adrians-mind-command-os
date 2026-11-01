import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { clampGuardRadius } from "./focus-bloom-guard.ts";
import { sunScreenUv } from "./god-rays.ts";

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
        if (i < rectCount) mask = max(mask, rectMask(rects[i]));
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
  dispose: () => void;
};

export function createDetailBackdropDimPass(): DetailBackdropDimHandle {
  const pass = new ShaderPass(DetailBackdropDimShader);
  const u = pass.uniforms as unknown as DimUniforms;
  // ShaderPass clones uniforms; make vector/array values per-instance.
  u.rects.value = [new THREE.Vector4(), new THREE.Vector4()];
  u.feather.value = new THREE.Vector2(0.02, 0.02);
  u.holeUv.value = new THREE.Vector2(0.5, 0.5);
  let disposed = false;
  let uvRects: UvRect[] = [];
  let level = 0;
  let target = 0;
  let from = 0;
  let elapsed = DIM_EASE_MS;
  let reduced = false;

  const apply = () => {
    u.strength.value = disposed ? 0 : DIM_MAX * level;
    pass.enabled = !disposed && u.strength.value > 0.001 && u.rectCount.value > 0;
  };
  apply();

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
      const next = (rects ?? [])
        .map((r) => (viewport ? rectToUv(r, viewport) : null))
        .filter((r): r is UvRect => !!r)
        .slice(0, DIM_MAX_RECTS);
      if (next.length) {
        // Keep the previous rects while fading out; only overwrite with real ones.
        uvRects = next;
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
        u.rectCount.value = 0;
      }
      apply();
    },
    setHole(world, camera, radiusUv) {
      if (disposed) return;
      if (!world || !camera || ![world.x, world.y, world.z].every(Number.isFinite)) {
        u.holeRadius.value = 0;
        return;
      }
      camera.updateMatrixWorld();
      const s = sunScreenUv(world, camera);
      if (!s.visible) {
        u.holeRadius.value = 0;
        return;
      }
      u.holeUv.value.set(s.uv[0], s.uv[1]);
      u.holeRadius.value = clampGuardRadius(radiusUv ?? undefined);
      const cam = camera as THREE.PerspectiveCamera;
      u.aspect.value = cam.isPerspectiveCamera && Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 1;
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      if (reduced || elapsed >= DIM_EASE_MS) level = target;
      else {
        elapsed = Math.min(DIM_EASE_MS, elapsed + dt);
        level = from + (target - from) * smooth01(elapsed / DIM_EASE_MS);
      }
      if (target === 0 && level <= 0.001) {
        uvRects = [];
        u.rectCount.value = 0;
      }
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      level = 0;
      target = 0;
      uvRects = [];
      u.rectCount.value = 0;
      apply();
      pass.dispose();
    },
  };
}
