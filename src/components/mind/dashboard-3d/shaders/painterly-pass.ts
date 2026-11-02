import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLSL_HASH_NOISE } from "./glsl-noise.ts";
import { sanitizeFinite, sanitizeShaderTime } from "../materials/paper-grain.ts";
import { resolvePainterlyRenderTargetType } from "../materials/painter-depth.ts";

/** Max drawing-buffer edge for painterly pass / composer resize helpers. */
export const PAINTER_PASS_MAX_EDGE = 4096;
export const PAINTER_PASS_MIN_EDGE = 1;
export const PAINTER_PASS_MAX_DPR = 3;
export const PAINTER_AMOUNT_MIN = 0.08;
export const PAINTER_AMOUNT_MAX = 0.85;
export const PAINTER_AMOUNT_DEFAULT = 0.42;
/** Coalesce rapid resizePass storms — min ms between actual setSize calls. */
export const PAINTER_RESIZE_MIN_INTERVAL_MS = 48;

/** Post-process: watercolor wash + anisotropic paper-fiber grain + mild edge soft (no external textures). */
export const PainterlyPassShader = {
  name: "PainterlyPassShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: PAINTER_AMOUNT_DEFAULT },
    grain: { value: 0.09 },
    wash: { value: 0.38 },
    /** c16: anisotropic paper-fiber strength 0..1 (from real setPassHealth amount). */
    fiber: { value: 0.35 },
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
    uniform float fiber;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      // c16: paper-fiber direction from real amount (deterministic tilt — no fabricated weather)
      float fib = clamp(fiber, 0.0, 1.0);
      float ang = amount * 1.2;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 fUv = vec2(
        dot(uv * 56.0, dir) * (1.0 + fib * 1.75),
        dot(uv * 56.0, perp) * mix(1.0, 0.42, fib)
      );
      float n = paintFbm(paintWrap(fUv) + time * 0.04);
      vec2 brush = (vec2(
        paintNoise(paintWrap(uv * 48.0 + vec2(time * 0.02, 0.0))),
        paintNoise(paintWrap(uv * 48.0 + vec2(0.0, 3.1)))
      ) - 0.5) * amount * 0.014;
      // Stretch brush slightly along fiber so wash follows paper grain
      brush += dir * ((n - 0.5) * amount * 0.006 * fib);
      vec4 c = texture2D(tDiffuse, uv + brush);
      vec4 blur = (
        texture2D(tDiffuse, uv + vec2( brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(-brush.x, 0.0)) +
        texture2D(tDiffuse, uv + vec2(0.0,  brush.y)) +
        texture2D(tDiffuse, uv + vec2(0.0, -brush.y))
      ) * 0.25;
      c.rgb = mix(c.rgb, blur.rgb, wash);
      // anisotropic paper grain (fiber-stretched)
      float g = (n - 0.5) * grain * amount * (0.65 + fib * 0.55);
      c.rgb += g;
      // Unified painterly palette (c11): warm paper midtones + cool indigo shadows
      // driven only by real amount (from setPassHealth) — no fabricated scene data.
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 paperWarm = vec3(1.02, 0.97, 0.90);
      vec3 indigoCool = vec3(0.90, 0.93, 1.08);
      float warmAmt = smoothstep(0.15, 0.65, luma) * amount;
      float coolAmt = (1.0 - smoothstep(0.05, 0.45, luma)) * amount;
      c.rgb *= mix(vec3(1.0), paperWarm, warmAmt * 0.22);
      c.rgb *= mix(vec3(1.0), indigoCool, coolAmt * 0.18);
      // Soft pigment lift on mids so sky/stars/city share one wash grade
      c.rgb = mix(c.rgb, c.rgb * vec3(0.96, 0.98, 1.04), 0.14 * amount);
      // Paper vignette (tuned): stronger edge pool, softer center
      float vig = smoothstep(1.22, 0.28, length(uv - 0.5));
      c.rgb *= mix(0.72, 1.0, vig);
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
    fiber: { value: 0 },
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
  /** Anisotropic paper-fiber strength 0..1 (defaults from amount when omitted). */
  fiber?: number;
  /** Force identity fallback (tests / known-bad environments). */
  forceFallback?: boolean;
  /** Explicit composer RT type (HalfFloatType / UnsignedByteType). */
  renderTargetType?: import("three").TextureDataType;
  /** Probe result — false → UnsignedByteType fallback. */
  halfFloatSupported?: boolean;
  /** Force byte RT (MSAA / SwiftShader / tests). */
  forceUnsignedByte?: boolean;
};

export const PAINTER_FIBER_DEFAULT = 0.35;
export const PAINTER_FIBER_MIN = 0.08;
export const PAINTER_FIBER_MAX = 0.85;

/** Map real pass amount → fiber strength (neutral mid when amount unknown/min). */
export function painterlyFiberFromAmount(amount: number): number {
  const a = sanitizeFinite(amount, PAINTER_AMOUNT_DEFAULT, PAINTER_AMOUNT_MIN, PAINTER_AMOUNT_MAX);
  const t = (a - PAINTER_AMOUNT_MIN) / (PAINTER_AMOUNT_MAX - PAINTER_AMOUNT_MIN);
  return sanitizeFinite(
    PAINTER_FIBER_MIN + (PAINTER_FIBER_MAX - PAINTER_FIBER_MIN) * t,
    PAINTER_FIBER_DEFAULT,
    PAINTER_FIBER_MIN,
    PAINTER_FIBER_MAX,
  );
}


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
  /** HACKER (c11): resizes deferred during DPR/resize storms. */
  stormSkipped: number;
  lastResizeAt: number;
  pendingDw: number;
  pendingDh: number;
  hasPending: boolean;
  compileError: string | null;
  fallback: boolean;
  /** Scratch — never reallocated in tick/setHealth hot paths. */
  _healthHealthy: number;
  _healthTotal: number;
  /** When true, setPainterlyPassAmount does not rewrite fiber. */
  fiberLocked?: boolean;
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
      stormSkipped: 0,
      lastResizeAt: 0,
      pendingDw: 0,
      pendingDh: 0,
      hasPending: false,
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
function applyPainterlyPassDrawingSize(pass: ShaderPass, m: PassMeta, dw: number, dh: number): void {
  m.lastDw = dw;
  m.lastDh = dh;
  m.resizeCount += 1;
  m.lastResizeAt = Date.now();
  m.hasPending = false;
  try {
    pass.setSize(dw, dh);
  } catch (err) {
    m.compileError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Resize helper: no-ops when drawing size unchanged; coalesces DPR/resize storms
 * (HACKER c11) so rapid alternating sizes cannot thrash RTs. Safe after dispose.
 * Pending size is flushed from tickPainterlyPass / flushPainterlyPassResize.
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
  if (size.drawingWidth === m.lastDw && size.drawingHeight === m.lastDh && !m.hasPending) {
    m.skippedResize += 1;
    return size;
  }
  const now = Date.now();
  if (
    m.lastResizeAt > 0 &&
    now - m.lastResizeAt < PAINTER_RESIZE_MIN_INTERVAL_MS &&
    (size.drawingWidth !== m.lastDw || size.drawingHeight !== m.lastDh)
  ) {
    // Storm: remember latest desired size; do not call setSize yet
    m.pendingDw = size.drawingWidth;
    m.pendingDh = size.drawingHeight;
    m.hasPending = true;
    m.stormSkipped += 1;
    return size;
  }
  applyPainterlyPassDrawingSize(pass, m, size.drawingWidth, size.drawingHeight);
  return size;
}

/** Apply coalesced pending resize (call from tick). Returns true if applied. */
export function flushPainterlyPassResize(pass: ShaderPass): boolean {
  const m = metaOf(pass);
  if (m.disposed || !m.hasPending) return false;
  const now = Date.now();
  if (m.lastResizeAt > 0 && now - m.lastResizeAt < PAINTER_RESIZE_MIN_INTERVAL_MS) return false;
  if (m.pendingDw === m.lastDw && m.pendingDh === m.lastDh) {
    m.hasPending = false;
    return false;
  }
  applyPainterlyPassDrawingSize(pass, m, m.pendingDw, m.pendingDh);
  return true;
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
  // c16: fiber tracks real health-driven amount (neutral default via painterlyFiberFromAmount)
  if (pass.uniforms["fiber"]) {
    pass.uniforms["fiber"].value = painterlyFiberFromAmount(amount);
  }
  return amount;
}

export function setPainterlyPassAmount(pass: ShaderPass, amount: number): number {
  const m = metaOf(pass);
  if (m.disposed) return 0;
  const v = sanitizeFinite(amount, PAINTER_AMOUNT_DEFAULT, 0, PAINTER_AMOUNT_MAX);
  if (pass.uniforms["amount"]) pass.uniforms["amount"].value = v;
  if (pass.uniforms["fiber"] && !(m as PassMeta & { fiberLocked?: boolean }).fiberLocked) {
    pass.uniforms["fiber"].value = painterlyFiberFromAmount(v);
  }
  return v;
}

export function setPainterlyPassFiber(pass: ShaderPass, fiber: number): number {
  const m = metaOf(pass);
  if (m.disposed) return 0;
  const v = sanitizeFinite(fiber, PAINTER_FIBER_DEFAULT, 0, 1);
  if (pass.uniforms["fiber"]) pass.uniforms["fiber"].value = v;
  (m as PassMeta & { fiberLocked?: boolean }).fiberLocked = true;
  return v;
}

/**
 * HACKER (c16): live status feeds / HMR can write NaN into pass uniforms and black
 * the composer for a frame. Re-sanitize amount/grain/wash/fiber every tick.
 * Returns how many uniforms were repaired.
 */
export function sanitizePainterlyPassUniforms(pass: ShaderPass): number {
  const m = metaOf(pass);
  if (m.disposed) return 0;
  let repaired = 0;
  const u = pass.uniforms;
  if (u["amount"]) {
    const cur = u["amount"].value as number;
    const v = sanitizeFinite(cur, PAINTER_AMOUNT_DEFAULT, 0, PAINTER_AMOUNT_MAX);
    if (v !== cur) {
      u["amount"].value = v;
      repaired += 1;
    }
  }
  if (u["grain"]) {
    const cur = u["grain"].value as number;
    const v = sanitizeFinite(cur, 0.09, 0, 1);
    if (v !== cur) {
      u["grain"].value = v;
      repaired += 1;
    }
  }
  if (u["wash"]) {
    const cur = u["wash"].value as number;
    const v = sanitizeFinite(cur, 0.38, 0, 1);
    if (v !== cur) {
      u["wash"].value = v;
      repaired += 1;
    }
  }
  if (u["fiber"]) {
    const cur = u["fiber"].value as number;
    const v = sanitizeFinite(cur, PAINTER_FIBER_DEFAULT, 0, 1);
    if (v !== cur) {
      u["fiber"].value = v;
      repaired += 1;
    }
  }
  if (u["time"]) {
    const cur = u["time"].value as number;
    if (!Number.isFinite(cur)) {
      u["time"].value = 0;
      repaired += 1;
    }
  }
  return repaired;
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
      !PainterlyPassShader.fragmentShader.includes("amount") ||
      !PainterlyPassShader.fragmentShader.includes("fiber")
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
  if (opts.fiber != null) {
    setPainterlyPassFiber(pass, opts.fiber);
  } else if (pass.uniforms["fiber"] && pass.uniforms["amount"]) {
    pass.uniforms["fiber"].value = painterlyFiberFromAmount(
      pass.uniforms["amount"].value as number,
    );
  }
  // HACKER (c20): record RT type on existing PassMeta (do not replace resize bookkeeping)
  const rt = opts.renderTargetType != null
    ? {
        type: opts.renderTargetType,
        halfFloat: false,
        reason: "explicit",
      }
    : resolvePainterlyRenderTargetType({
        halfFloatSupported: opts.halfFloatSupported,
        forceUnsignedByte: opts.forceUnsignedByte,
      });
  (m as PassMeta & {
    renderTargetType?: unknown;
    halfFloat?: boolean;
    renderTargetReason?: string | null;
  }).renderTargetType = rt.type;
  (m as PassMeta & { halfFloat?: boolean }).halfFloat = rt.halfFloat;
  (m as PassMeta & { renderTargetReason?: string | null }).renderTargetReason = rt.reason;
  return pass;
}

/**
 * Per-frame tick — MUST NOT allocate (no new Vector/Color/Object).
 * Only writes numeric uniforms.
 */
export function tickPainterlyPass(pass: ShaderPass, timeSeconds: number): void {
  const m = metaOf(pass);
  if (m.disposed) return;
  // HACKER (c11): apply coalesced resize after storm window
  flushPainterlyPassResize(pass);
  // HACKER (c16): scrub NaN uniforms from live feeds before draw
  sanitizePainterlyPassUniforms(pass);
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
  stormSkipped: number;
  hasPending: boolean;
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
    stormSkipped: m.stormSkipped,
    hasPending: m.hasPending,
    lastDw: m.lastDw,
    lastDh: m.lastDh,
    disposed: m.disposed,
    fallback: m.fallback,
    compileError: m.compileError,
  };
}
