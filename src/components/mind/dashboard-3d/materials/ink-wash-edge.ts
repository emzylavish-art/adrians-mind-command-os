import * as THREE from "three";
import { InkWashEdgeShader } from "../shaders/ink-wash-edge.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type HealthTone = "healthy" | "stalled" | "blocked" | "idle";

export const HEALTH_RGB: Record<HealthTone, [number, number, number]> = {
  healthy: [0.24, 0.84, 0.55],
  stalled: [0.98, 0.75, 0.14],
  blocked: [1.0, 0.42, 0.54],
  idle: [0.36, 0.42, 0.55],
};

export type InkWashEdgeOptions = {
  health?: HealthTone | THREE.ColorRepresentation;
  ink?: number;
  pulse?: number;
  /** Watercolor edge bleed from real weight (0..1.5). Neutral default 0.35. */
  bleed?: number;
};

function resolveHealthColor(
  health: InkWashEdgeOptions["health"],
): THREE.Color {
  // HACKER FIX (c3): `in` matched prototype keys ("constructor", "toString") -> NaN uniform.
  if (typeof health === "string" && Object.prototype.hasOwnProperty.call(HEALTH_RGB, health)) {
    const rgb = HEALTH_RGB[health as HealthTone];
    return new THREE.Color(rgb[0], rgb[1], rgb[2]);
  }
  if (health != null && typeof health !== "string") {
    const c = new THREE.Color(health);
    if (Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)) return c;
    const rgb = HEALTH_RGB.idle;
    return new THREE.Color(rgb[0], rgb[1], rgb[2]);
  }
  if (typeof health === "string") {
    // unknown string tone → idle (explicit, not silent black)
    const rgb = HEALTH_RGB.idle;
    return new THREE.Color(rgb[0], rgb[1], rgb[2]);
  }
  const rgb = HEALTH_RGB.healthy;
  return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}

function cloneUniforms(src: typeof InkWashEdgeShader.uniforms) {
  return {
    uHealth: { value: new THREE.Color(src.uHealth.value[0], src.uHealth.value[1], src.uHealth.value[2]) },
    uTime: { value: 0 },
    uInk: { value: src.uInk.value },
    uPulse: { value: src.uPulse.value },
    uBleed: { value: src.uBleed.value },
  };
}

/** Health-tinted ink-wash ribbon material for constellation edges. */
export function createInkWashEdgeMaterial(opts: InkWashEdgeOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(InkWashEdgeShader.uniforms);
  uniforms.uHealth.value.copy(resolveHealthColor(opts.health));
  if (opts.ink != null) uniforms.uInk.value = sanitizeFinite(opts.ink, 0.65, 0, 2);
  if (opts.pulse != null) uniforms.uPulse.value = sanitizeFinite(opts.pulse, 0.35, 0, 1);
  if (opts.bleed != null) uniforms.uBleed.value = sanitizeFinite(opts.bleed, 0.35, 0, 1.5);
  return new THREE.ShaderMaterial({
    name: "InkWashEdgeMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: InkWashEdgeShader.vertexShader,
    fragmentShader: InkWashEdgeShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function tickInkWashEdgeMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

export function setInkWashEdgeHealth(
  mat: THREE.ShaderMaterial,
  health: HealthTone | THREE.ColorRepresentation,
): void {
  if (mat.uniforms["uHealth"]) {
    (mat.uniforms["uHealth"].value as THREE.Color).copy(resolveHealthColor(health));
  }
}

/** Real edge weight → watercolor bleed. Health severity + hub/link kind; no fabricated activity. */
export function inkBleedFromWeight(tone: HealthTone, kind?: string): number {
  const base: Record<HealthTone, number> = {
    healthy: 0.28,
    stalled: 0.55,
    blocked: 0.88,
    idle: 0.2,
  };
  const b = base[tone] ?? 0.35;
  const kindMul = kind === "hub" ? 0.75 : 1.0;
  return sanitizeFinite(b * kindMul, 0.35, 0, 1.5);
}

export function setInkWashEdgeBleed(mat: THREE.ShaderMaterial, bleed: number): void {
  if (mat.uniforms["uBleed"]) {
    mat.uniforms["uBleed"].value = sanitizeFinite(bleed, 0.35, 0, 1.5);
  }
}


/**
 * Sanitize a parallel health-tone array for multi-edge updates.
 * Out-of-bounds / odd entries become "idle" with an explicit badCount — no silent skip of length mismatch without report.
 */
export function sanitizeHealthToneArray(
  tones: unknown,
  expectedLength?: number,
): { tones: HealthTone[]; badCount: number; length: number } {
  const allowed = new Set<string>(["healthy", "stalled", "blocked", "idle"]);
  const arr = Array.isArray(tones) ? tones : [];
  const out: HealthTone[] = [];
  let badCount = 0;
  const target =
    expectedLength != null && Number.isFinite(expectedLength)
      ? Math.max(0, Math.min(4096, Math.floor(expectedLength)))
      : arr.length;
  for (let i = 0; i < target; i++) {
    const raw = arr[i];
    if (typeof raw === "string" && allowed.has(raw)) {
      out.push(raw as HealthTone);
    } else {
      out.push("idle");
      badCount += 1;
    }
  }
  if (expectedLength == null && !Array.isArray(tones)) badCount += 1;
  return { tones: out, badCount, length: out.length };
}

export type InkWashRibbonOptions = {
  /** Ribbon width in world units (clamped 0.01..8). */
  width?: number;
  /** Lengthwise segments (clamped 1..256) so the fbm wash bends smoothly. */
  segments?: number;
  /** Mid-span sag/arc as a fraction of edge length (clamped -0.5..0.5). */
  arc?: number;
};

export const INK_RIBBON_MAX_SEGMENTS = 256;
/** Edges shorter than this (after sanitize) are degenerate — skip in batch helpers. */
export const INK_EDGE_DEGENERATE_EPS = 1e-5;
/** Hard cap for one-call ink edge adopt (prevents OOM on flood graphs). */
export const INK_EDGES_MAX = 512;


type Vec3Like = readonly [number, number, number] | { x: number; y: number; z: number };

function toVec3(v: Vec3Like): THREE.Vector3 {
  const arr = Array.isArray(v) ? v : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z];
  return new THREE.Vector3(
    sanitizeFinite(Number(arr[0]), 0, -1e6, 1e6),
    sanitizeFinite(Number(arr[1]), 0, -1e6, 1e6),
    sanitizeFinite(Number(arr[2]), 0, -1e6, 1e6),
  );
}

/** Finite edge length after coordinate sanitize; 0 for coincident/NaN endpoints. */
export function measureInkEdgeLength(from: Vec3Like, to: Vec3Like): number {
  const a = toVec3(from);
  const b = toVec3(to);
  const d = a.distanceTo(b);
  return Number.isFinite(d) ? d : 0;
}

export function isDegenerateInkEdge(from: Vec3Like, to: Vec3Like, eps = INK_EDGE_DEGENERATE_EPS): boolean {
  return measureInkEdgeLength(from, to) < eps;
}

/**
 * Camera-facing ribbon geometry spanning a constellation edge. Positions are the
 * (optionally arced) centreline; the vertex shader offsets each vertex sideways by
 * `aSide` in view space using `aTangent`. uv.x runs 0→1 along the edge, uv.y 0→1
 * across. Hostile endpoints (NaN/Infinity), zero-length edges and huge segment
 * counts are sanitized so the GPU never receives NaN attributes.
 */
export function buildInkWashRibbon(
  from: Vec3Like,
  to: Vec3Like,
  opts: InkWashRibbonOptions = {},
): THREE.BufferGeometry {
  const a = toVec3(from);
  const b = toVec3(to);
  const width = sanitizeFinite(opts.width ?? 0.35, 0.35, 0.01, 8);
  const segments = Math.floor(sanitizeFinite(opts.segments ?? 24, 24, 1, INK_RIBBON_MAX_SEGMENTS));
  const arc = sanitizeFinite(opts.arc ?? 0.06, 0.06, -0.5, 0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-6) dir.set(1, 0, 0);
  else dir.divideScalar(len);
  // bow direction for the arc: perpendicular to the edge, stable up choice
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const bow = new THREE.Vector3().crossVectors(new THREE.Vector3().crossVectors(dir, up), dir).normalize();
  const verts = segments + 1;
  const pos = new Float32Array(verts * 2 * 3);
  const tan = new Float32Array(verts * 2 * 3);
  const sideArr = new Float32Array(verts * 2);
  const uv = new Float32Array(verts * 2 * 2);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const tng = new THREE.Vector3();
  for (let i = 0; i < verts; i++) {
    const t = i / segments;
    // brush taper: thinner at both ends like a lifted brush
    const taper = 0.35 + 0.65 * Math.sin(Math.PI * t);
    const half = (width * taper) / 2;
    p.copy(a).lerp(b, t).addScaledVector(bow, Math.sin(Math.PI * t) * arc * len);
    // tangent of the arced curve (derivative of the bow term)
    tng.copy(dir).multiplyScalar(len > 1e-6 ? len : 1)
      .addScaledVector(bow, Math.cos(Math.PI * t) * Math.PI * arc * len);
    if (tng.lengthSq() < 1e-12) tng.copy(dir);
    tng.normalize();
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      tan[k * 3] = tng.x;
      tan[k * 3 + 1] = tng.y;
      tan[k * 3 + 2] = tng.z;
      sideArr[k] = s === 0 ? -half : half;
      uv[k * 2] = t;
      uv[k * 2 + 1] = s;
    }
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aTangent", new THREE.BufferAttribute(tan, 3));
  g.setAttribute("aSide", new THREE.BufferAttribute(sideArr, 1));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // side offsets are applied in the shader: pad bounds so frustum culling never clips the wash
  if (g.boundingSphere) g.boundingSphere.radius += width;
  return g;
}
