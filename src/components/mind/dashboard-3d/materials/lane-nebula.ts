import * as THREE from "three";
import { LaneNebulaShader } from "../shaders/lane-nebula.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import { PAINTER_RENDER_ORDER, applyPainterTransparentLayer, applyPainterLogDepthSupport } from "./painter-depth.ts";
import type { HealthTone } from "./ink-wash-edge.ts";
import { HEALTH_RGB } from "./ink-wash-edge.ts";
import type { PainterlyKit } from "./use-painterly-kit.ts";

/** Hard cap — hostile/huge constellation dumps must not spawn unbounded mats/meshes. */
export const LANE_NEBULAE_MAX = 32;

/** Wash strength by real lane health (neutral idle default). */
export const LANE_WASH_BY_HEALTH: Record<HealthTone, number> = {
  healthy: 0.48,
  stalled: 0.72,
  blocked: 0.95,
  idle: 0.35,
};

/** Pigment pool by real lane health — blocked pools heaviest. */
export const LANE_POOL_BY_HEALTH: Record<HealthTone, number> = {
  healthy: 0.32,
  stalled: 0.62,
  blocked: 0.95,
  idle: 0.22,
};

export type LaneNebulaOptions = {
  health?: HealthTone | THREE.ColorRepresentation;
  opacity?: number;
  wash?: number;
  pool?: number;
};

function resolveHealth(health: LaneNebulaOptions["health"]): THREE.Color {
  if (typeof health === "string" && Object.prototype.hasOwnProperty.call(HEALTH_RGB, health)) {
    const rgb = HEALTH_RGB[health as HealthTone];
    return new THREE.Color(rgb[0], rgb[1], rgb[2]);
  }
  if (health != null && typeof health !== "string") {
    const c = new THREE.Color(health);
    if (Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)) return c;
  }
  const rgb = HEALTH_RGB.idle;
  return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}

function cloneUniforms(src: typeof LaneNebulaShader.uniforms) {
  return {
    uHealth: { value: new THREE.Color(src.uHealth.value[0], src.uHealth.value[1], src.uHealth.value[2]) },
    uTime: { value: 0 },
    uOpacity: { value: src.uOpacity.value },
    uWash: { value: src.uWash.value },
    uPool: { value: src.uPool.value },
  };
}

/** Health-tinted watercolor lane nebula (replaces MeshBasicMaterial tint spheres). */
export function createLaneNebulaMaterial(opts: LaneNebulaOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(LaneNebulaShader.uniforms);
  uniforms.uHealth.value.copy(resolveHealth(opts.health));
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.22, 0.02, 0.85);
  if (opts.wash != null) uniforms.uWash.value = sanitizeFinite(opts.wash, 0.65, 0, 2);
  if (opts.pool != null) uniforms.uPool.value = sanitizeFinite(opts.pool, 0.45, 0, 1.5);
  // When health tone string given and wash/pool omitted, derive from real tone
  if (typeof opts.health === "string" && Object.prototype.hasOwnProperty.call(LANE_POOL_BY_HEALTH, opts.health)) {
    const tone = opts.health as HealthTone;
    if (opts.wash == null) uniforms.uWash.value = LANE_WASH_BY_HEALTH[tone];
    if (opts.pool == null) uniforms.uPool.value = LANE_POOL_BY_HEALTH[tone];
  }
  const mat = new THREE.ShaderMaterial({
    name: "LaneNebulaMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: LaneNebulaShader.vertexShader,
    fragmentShader: LaneNebulaShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });
  applyPainterLogDepthSupport(mat);
  return mat;
}

export function tickLaneNebulaMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

export function setLaneNebulaHealth(
  mat: THREE.ShaderMaterial,
  health: LaneNebulaOptions["health"],
): void {
  if (mat.uniforms["uHealth"]) {
    (mat.uniforms["uHealth"].value as THREE.Color).copy(resolveHealth(health));
  }
  if (typeof health === "string" && Object.prototype.hasOwnProperty.call(LANE_POOL_BY_HEALTH, health)) {
    const tone = health as HealthTone;
    if (mat.uniforms["uWash"]) mat.uniforms["uWash"].value = LANE_WASH_BY_HEALTH[tone];
    if (mat.uniforms["uPool"]) mat.uniforms["uPool"].value = LANE_POOL_BY_HEALTH[tone];
  }
}

export function setLaneNebulaPool(mat: THREE.ShaderMaterial, pool: number): void {
  if (mat.uniforms["uPool"]) {
    mat.uniforms["uPool"].value = sanitizeFinite(pool, 0.45, 0, 1.5);
  }
}

export type LaneNebulaInput = {
  health?: HealthTone | string;
  center: readonly [number, number, number] | { x: number; y: number; z: number };
  /** World radius (default 2.4 to match current MeshBasic spheres). */
  radius?: number;
  opacity?: number;
  id?: string;
};

export type PainterlyLaneNebulaeHandle = {
  group: THREE.Group;
  update: (lanes: LaneNebulaInput[]) => void;
  tick: (timeSeconds: number, reducedMotion?: boolean) => void;
  dispose: () => void;
  count: number;
  truncated: boolean;
  skippedInvalid: number;
  /** Shared health materials in kit.tracked for this handle (≤4). */
  materialCount: number;
  /** Meshes allocated in the pool (grows to peak lane count, never per-frame churn). */
  meshPoolSize: number;
};

function asTone(h: unknown): HealthTone {
  if (h === "healthy" || h === "stalled" || h === "blocked" || h === "idle") return h;
  return "idle";
}

function toArr(c: LaneNebulaInput["center"] | null | undefined): [number, number, number] | null {
  if (c == null) return null;
  if (Array.isArray(c)) {
    if (c.length < 3) return null;
    const x = Number(c[0]);
    const y = Number(c[1]);
    const z = Number(c[2]);
    if (![x, y, z].every((n) => Number.isFinite(n))) return null;
    return [
      sanitizeFinite(x, 0, -1e5, 1e5),
      sanitizeFinite(y, 0, -1e5, 1e5),
      sanitizeFinite(z, 0, -1e5, 1e5),
    ];
  }
  if (typeof c !== "object") return null;
  const o = c as { x: number; y: number; z: number };
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  if (![x, y, z].every((n) => Number.isFinite(n))) return null;
  return [
    sanitizeFinite(x, 0, -1e5, 1e5),
    sanitizeFinite(y, 0, -1e5, 1e5),
    sanitizeFinite(z, 0, -1e5, 1e5),
  ];
}

const TONES: HealthTone[] = ["healthy", "stalled", "blocked", "idle"];

/**
 * One-call constellation lane nebulae for Dashboard Bot `rebuildNebulae`.
 * HACKER (c10): caps at LANE_NEBULAE_MAX; skips NaN/invalid centers; shares ≤4
 * health materials (not one mat per lane) so tick uniform cost stays bounded.
 * HACKER (c14): mesh pool — lanes appearing/disappearing must not allocate a new
 * Mesh every update (GC churn / material bind thrash).
 *
 * ```ts
 * const neb = kit.createLaneNebulae(status.constellations.map(l => ({
 *   health: l.health, center: l.center,
 * })));
 * ```
 */
export function createPainterlyLaneNebulae(
  kit: PainterlyKit,
  lanes: LaneNebulaInput[] = [],
): PainterlyLaneNebulaeHandle {
  const group = new THREE.Group();
  group.name = "PainterlyLaneNebulae";
  const sharedGeo = new THREE.SphereGeometry(1, 24, 16);
  const matsByTone = new Map<HealthTone, THREE.ShaderMaterial>();
  /** Stable mesh pool — grow to peak, hide extras (no per-update new Mesh). */
  const meshPool: THREE.Mesh[] = [];
  let disposed = false;
  let count = 0;
  let truncated = false;
  let skippedInvalid = 0;
  let frozenTime = 0;

  for (const tone of TONES) {
    const idle = tone === "idle";
    const mat = createLaneNebulaMaterial({
      health: tone,
      opacity: idle ? 0.1 : 0.32,
      wash: LANE_WASH_BY_HEALTH[tone],
      pool: LANE_POOL_BY_HEALTH[tone],
    });
    kit.tracked.push(mat);
    matsByTone.set(tone, mat);
  }

  const ensurePool = (n: number) => {
    while (meshPool.length < n) {
      const mesh = new THREE.Mesh(sharedGeo, matsByTone.get("idle")!);
      mesh.visible = false;
      mesh.renderOrder = PAINTER_RENDER_ORDER.nebula;
      applyPainterTransparentLayer(mesh.material as THREE.Material, "nebula", mesh);
      mesh.frustumCulled = true;
      group.add(mesh);
      meshPool.push(mesh);
    }
  };

  const releaseMats = () => {
    for (const mat of matsByTone.values()) {
      const i = kit.tracked.indexOf(mat);
      if (i >= 0) kit.tracked.splice(i, 1);
      try {
        mat.dispose();
      } catch {
        /* already disposed */
      }
    }
    matsByTone.clear();
  };

  const update = (next: LaneNebulaInput[]) => {
    if (disposed) return;
    const arr = Array.isArray(next) ? next : [];
    truncated = arr.length > LANE_NEBULAE_MAX;
    skippedInvalid = 0;
    const slice = truncated ? arr.slice(0, LANE_NEBULAE_MAX) : arr;
    const valid: { center: [number, number, number]; tone: HealthTone; radius: number; id?: string }[] = [];
    for (const lane of slice) {
      const center = toArr(lane.center);
      if (!center) {
        skippedInvalid += 1;
        continue;
      }
      const tone = asTone(lane.health);
      valid.push({
        center,
        tone,
        radius: sanitizeFinite(lane.radius ?? 2.4, 2.4, 0.2, 40),
        id: lane.id,
      });
    }
    ensurePool(valid.length);
    // Refresh shared mat pool/wash from tone (real health) each update
    for (const tone of TONES) {
      const mat = matsByTone.get(tone)!;
      setLaneNebulaHealth(mat, tone);
    }
    for (let i = 0; i < meshPool.length; i++) {
      const mesh = meshPool[i]!;
      if (i >= valid.length) {
        mesh.visible = false;
        continue;
      }
      const lane = valid[i]!;
      mesh.material = matsByTone.get(lane.tone)!;
      mesh.position.set(lane.center[0], lane.center[1], lane.center[2]);
      mesh.scale.setScalar(lane.radius);
      mesh.visible = true;
      if (lane.id) mesh.userData.laneId = lane.id;
      else delete mesh.userData.laneId;
      mesh.userData.laneHealth = lane.tone;
    }
    count = valid.length;
  };

  const tick = (t: number, reducedMotion = false) => {
    if (disposed) return;
    const time = reducedMotion ? frozenTime : t;
    if (!reducedMotion) frozenTime = t;
    for (const mat of matsByTone.values()) tickLaneNebulaMaterial(mat, time);
  };

  let geoDisposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const mesh of meshPool) {
      group.remove(mesh);
      mesh.visible = false;
    }
    meshPool.length = 0;
    releaseMats();
    if (!geoDisposed) {
      try {
        sharedGeo.dispose();
      } catch {
        /* */
      }
      geoDisposed = true;
    }
    while (group.children.length) group.remove(group.children[0]!);
  };

  update(lanes);

  return {
    group,
    update,
    tick,
    dispose,
    get count() {
      return count;
    },
    get truncated() {
      return truncated;
    },
    get skippedInvalid() {
      return skippedInvalid;
    },
    get materialCount() {
      return matsByTone.size;
    },
    get meshPoolSize() {
      return meshPool.length;
    },
  };
}
