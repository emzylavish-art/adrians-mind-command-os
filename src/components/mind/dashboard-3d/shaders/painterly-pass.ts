import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLSL_HASH_NOISE } from "./glsl-noise.ts";
import { sanitizeFinite, sanitizeShaderTime } from "../materials/paper-grain.ts";

/** Max drawing-buffer edge for painterly pass / composer resize helpers. */
export const PAINTER_PASS_MAX_EDGE = 4096;
export const PAINTER_PASS_MIN_EDGE = 1;
export const PAINTER_PASS_MAX_DPR = 3;
export const PAINTER_AMOUNT_MIN = 0.08;
export const PAINTER_AMOUNT_MAX = 0.85;
export const PAINTER_AMOUNT_DEFAULT = 0.42;

/** Post-process: watercolor wash + paper grain + mild edge soft (no external textures). */
export const PainterlyPassShader = {
  name: "PainterlyPassShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: PAINTER_AMOUNT_DEFAULT },
    grain: { value: 0.09 },
    wash: { value: 0.38 },
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
    uniform float time;
    uniform float amount;
    uniform float grain;
    uniform float wash;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      float n = paintFbm(uv * 64.0 + time * 0.04);
      vec2 brush = (vec2(
        paintNoise(uv * 48.0 + vec2(time * 0.02, 0.0)),
        paintNoise(uv * 48.0 + vec2(0.0, 3.1))
      ) - 0.5) * amount * 0.014;
      vec4 c = texture2D(tDiffuse, uv + brush);
      vec4 blur = (
        texture2D(tDiffuse, uv + vec2( brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(-brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(0.0,  brush.y)) +
        texture2D(tDiffuse, uv + vec2(0.0, -brush.y))
      ) * 0.25;
      c.rgb = mix(c.rgb, blur.rgb, wash);
      // paper grain
      float g = (n - 0.5) * grain * amount;
      c.rgb += g;
      // watercolor edge darken / vignette
      float vig = smoothstep(1.15, 0.32, length(uv - 0.5));
      c.rgb *= mix(0.78, 1.0, vig);
      // slight pigment shift toward indigo wash
      c.rgb = mix(c.rgb, c.rgb * vec3(0.94, 0.96, 1.05), 0.12 * amount);
      gl_FragColor = c;
    }
  `,
};

/** Identity copy — used when the painterly shader cannot be constructed. */
export const PainterlyPassFallbackShader = {
  name: "PainterlyPassFallbackShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: 0 },
    grain: { value: 0 },
    wash: { value: 0 },
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
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  `,
};

export type PainterlyPassOptions = {
  amount?: number;
  grain?: number;
  wash?: number;
  /** Force identity fallback (tests / known-bad environments). */
  forceFallback?: boolean;
};

export type PainterlyPassSize = {
  width: number;
  height: number;
  dpr: number;
  drawingWidth: number;
  drawingHeight: number;
};

type PassMeta = {
  disposed: boolean;
  lastDw: number;
  lastDh: number;
  resizeCount: number;
  skippedResize: number;
  compileError: string | null;
  fallback: boolean;
  /** Scratch — never reallocated in tick/setHealth hot paths. */
  _healthHealthy: number;
  _healthTotal: number;
};

function metaOf(pass: ShaderPass): PassMeta {
  const ud = pass as unknown as { userData?: Record<string, unknown> };
  if (!ud.userData) ud.userData = {};
  let m = ud.userData["painterPassMeta"] as PassMeta | undefined;
  if (!m) {
    m = {
      disposed: false,
      lastDw: 0,
      lastDh: 0,
      resizeCount: 0,
      skippedResize: 0,
      compileError: null,
      fallback: false,
      _healthHealthy: 0,
      _healthTotal: 0,
    };
    ud.userData["painterPassMeta"] = m;
  }
  return m;
}

/**
 * HACKER (c6): clamp CSS size × DPR so resize-to-0 / NaN / 8K×DPR cannot allocate
 * enormous composer/pass buffers. Drawing edges always ≥1 and ≤ PAINTER_PASS_MAX_EDGE.
 */
export function safePainterlyPassSize(
  width: number,
  height: number,
  dpr: number = 1,
): PainterlyPassSize {
  const d =
    Number.isFinite(dpr) && dpr > 0
      ? Math.min(PAINTER_PASS_MAX_DPR, Math.max(0.5, dpr))
      : 1;
  const clampCss = (v: number) =>
    Number.isFinite(v) ? Math.max(0, Math.min(PAINTER_PASS_MAX_EDGE, Math.round(v))) : 0;
  const w = clampCss(width);
  const h = clampCss(height);
  const clampDraw = (v: number) =>
    Math.max(PAINTER_PASS_MIN_EDGE, Math.min(PAINTER_PASS_MAX_EDGE, Math.round(v)));
  // 0×0 CSS still yields 1×1 drawing buffer (never allocate 0-size RT)
  const drawingWidth = clampDraw(w * d || PAINTER_PASS_MIN_EDGE);
  const drawingHeight = clampDraw(h * d || PAINTER_PASS_MIN_EDGE);
  return { width: Math.max(PAINTER_PASS_MIN_EDGE, w || PAINTER_PASS_MIN_EDGE), height: Math.max(PAINTER_PASS_MIN_EDGE, h || PAINTER_PASS_MIN_EDGE), dpr: d, drawingWidth, drawingHeight };
}

/**
 * Resize helper: no-ops when drawing size unchanged (avoids RT thrash / leaks on
 * spurious resize events). Safe after dispose. Does not allocate Vectors.
 */
export function resizePainterlyPass(
  pass: ShaderPass,
  width: number,
  height: number,
  dpr: number = 1,
): PainterlyPassSize {
  const m = metaOf(pass);
  const size = safePainterlyPassSize(width, height, dpr);
  if (m.disposed) return size;
  if (size.drawingWidth === m.lastDw && size.drawingHeight === m.lastDh) {
    m.skippedResize += 1;
    return size;
  }
  m.lastDw = size.drawingWidth;
  m.lastDh = size.drawingHeight;
  m.resizeCount += 1;
  // ShaderPass.setSize is a no-op by default; still call for subclasses / future RTs
  try {
    pass.setSize(size.drawingWidth, size.drawingHeight);
  } catch (err) {
    m.compileError = err instanceof Error ? err.message : String(err);
  }
  return size;
}

export type PainterlyHealthInputs = {
  /** Count of bots/nodes with health === "healthy" (real status data). */
  healthy: number;
  /** Total constellation nodes considered. */
  total: number;
  reducedMotion?: boolean;
  /** Base amount when ratio=1; defaults to PAINTER_AMOUNT_DEFAULT. */
  baseAmount?: number;
};

/**
 * Map real constellation health counts → painterly pass amount.
 * Junk / empty / reduced-motion → minimum (still visible wash, not full paint).
 * No fabricated node lists — only numeric healthy/total.
 */
export function painterlyAmountFromHealth(input: PainterlyHealthInputs): number {
  if (input.reducedMotion) return PAINTER_AMOUNT_MIN;
  const healthy = Number(input.healthy);
  const total = Number(input.total);
  if (!Number.isFinite(healthy) || !Number.isFinite(total) || total <= 0) {
    return PAINTER_AMOUNT_MIN;
  }
  const h = Math.max(0, healthy);
  const t = Math.max(0, total);
  const ratio = Math.min(1, Math.max(0, h / t));
  const base = sanitizeFinite(
    input.baseAmount ?? PAINTER_AMOUNT_DEFAULT,
    PAINTER_AMOUNT_DEFAULT,
    PAINTER_AMOUNT_MIN,
    PAINTER_AMOUNT_MAX,
  );
  // Idle fleet (ratio 0) → min; full healthy → base (clamped). Mild floor so pass never NaN.
  const amount = PAINTER_AMOUNT_MIN + (base - PAINTER_AMOUNT_MIN) * ratio;
  return sanitizeFinite(amount, PAINTER_AMOUNT_MIN, PAINTER_AMOUNT_MIN, PAINTER_AMOUNT_MAX);
}

/** Hot-path safe: updates amount uniform only (no object allocation). Returns amount. */
export function setPainterlyPassHealth(pass: ShaderPass, input: PainterlyHealthInputs): number {
  const m = metaOf(pass);
  if (m.disposed) return 0;
  m._healthHealthy = Number.isFinite(input.healthy) ? input.healthy : 0;
  m._healthTotal = Number.isFinite(input.total) ? input.total : 0;
  const amount = painterlyAmountFromHealth(input);
  if (pass.uniforms["amount"]) pass.uniforms["amount"].value = amount;
  return amount;
}

export function setPainterlyPassAmount(pass: ShaderPass, amount: number): number {
  const m = metaOf(pass);
  if (m.disposed) return 0;
  const v = sanitizeFinite(amount, PAINTER_AMOUNT_DEFAULT, 0, PAINTER_AMOUNT_MAX);
  if (pass.uniforms["amount"]) pass.uniforms["amount"].value = v;
  return v;
}

function buildPass(shader: typeof PainterlyPassShader | typeof PainterlyPassFallbackShader): ShaderPass {
  return new ShaderPass(shader);
}

/**
 * Create painterly post pass. On construction failure, logs via userData and
 * returns an identity fallback so the composer pipeline does not go black.
 */
export function createPainterlyPass(opts: PainterlyPassOptions = {}): ShaderPass {
  let pass: ShaderPass;
  let fallback = false;
  let compileError: string | null = null;
  try {
    if (opts.forceFallback) throw new Error("forceFallback");
    // Preflight: required GLSL tokens (catches truncated/corrupt shader modules)
    if (
      !PainterlyPassShader.fragmentShader.includes("paintFbm") ||
      !PainterlyPassShader.fragmentShader.includes("amount")
    ) {
      throw new Error("painterly-shader-preflight-failed");
    }
    pass = buildPass(PainterlyPassShader);
  } catch (err) {
    fallback = true;
    compileError = err instanceof Error ? err.message : String(err);
    pass = buildPass(PainterlyPassFallbackShader);
  }
  const m = metaOf(pass);
  m.fallback = fallback;
  m.compileError = compileError;
  if (opts.amount != null) setPainterlyPassAmount(pass, opts.amount);
  else if (!fallback) setPainterlyPassAmount(pass, PAINTER_AMOUNT_DEFAULT);
  if (opts.grain != null && pass.uniforms["grain"]) {
    pass.uniforms["grain"].value = sanitizeFinite(opts.grain, 0.09, 0, 1);
  }
  if (opts.wash != null && pass.uniforms["wash"]) {
    pass.uniforms["wash"].value = sanitizeFinite(opts.wash, 0.38, 0, 1);
  }
  return pass;
}

/**
 * Per-frame tick — MUST NOT allocate (no new Vector/Color/Object).
 * Only writes numeric uniforms.
 */
export function tickPainterlyPass(pass: ShaderPass, timeSeconds: number): void {
  const m = metaOf(pass);
  if (m.disposed) return;
  if (pass.uniforms["time"]) pass.uniforms["time"].value = sanitizeShaderTime(timeSeconds);
}

export function disposePainterlyPass(pass: ShaderPass): void {
  const m = metaOf(pass);
  if (m.disposed) return;
  m.disposed = true;
  try {
    pass.dispose();
  } catch {
    /* already invalid */
  }
}

/** Test/helper: read resize bookkeeping without allocating. */
export function painterlyPassResizeStats(pass: ShaderPass): {
  resizeCount: number;
  skippedResize: number;
  lastDw: number;
  lastDh: number;
  disposed: boolean;
  fallback: boolean;
  compileError: string | null;
} {
  const m = metaOf(pass);
  return {
    resizeCount: m.resizeCount,
    skippedResize: m.skippedResize,
    lastDw: m.lastDw,
    lastDh: m.lastDh,
    disposed: m.disposed,
    fallback: m.fallback,
    compileError: m.compileError,
  };
}
