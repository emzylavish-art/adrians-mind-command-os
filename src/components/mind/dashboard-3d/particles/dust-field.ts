import * as THREE from "three";
import { clampInt, finiteOr } from "../motion/sanitize.ts";
import { sharedMotionClock, type MotionClock } from "../motion/motion-clock.ts";
import {
  createWindGustSample,
  createWindGustState,
  impulseWindGust,
  stepWindGust,
  type WindGustSample,
  type WindGustState,
} from "../motion/wind-gust.ts";
import { createFrameBudget, dustDistanceFactor, isDocumentHidden, lodCount } from "./motion-lod.ts";

export const DUST_COUNT_MAX = 2048;
export const DUST_COUNT_DEFAULT = 480;

export type DustFieldHandle = {
  mesh: THREE.InstancedMesh | null;
  count: number;
  disposed: boolean;
  /** Live LOD state (read-only view for HUD/debug/tests). */
  lod: { active: number; camDistance: number; budget: number };
  /** Advance drift. No allocations. Safe after dispose (no-op). */
  update: (tSeconds: number, reducedMotion: boolean) => void;
  /**
   * Fleet-event gust impulse (comet/landing). Directional unit vector; strength 0..1.
   * No-op after dispose / under reduced-motion (caller passes flag into update).
   * Capped superposition — 1000 calls in one frame cannot exceed GUST_MAX_SPEED.
   */
  impulseGust: (dx: number, dy: number, dz: number, strength?: number) => void;
  /** Live gust sample (read-only debug). */
  gust: WindGustSample;
  dispose: () => void;
};

export type CreateDustFieldOpts = {
  count?: number;
  radius?: number;
  ySpread?: number;
  color?: number;
  seed?: number;
  size?: number;
  /** Continuous clock (default shared with star pulse / orbit drift). */
  clock?: MotionClock;
  /** Distance + frame-budget LOD on the active instance count. Default true. */
  lod?: boolean;
};

type DustSeed = {
  x: number;
  y: number;
  z: number;
  phase: number;
  speed: number;
  amp: number;
  scale: number;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDustParticles(count: number, radius: number, ySpread: number, seed: number): DustSeed[] {
  const n = clampInt(count, 0, DUST_COUNT_MAX, 0);
  const R = finiteOr(radius, 28);
  const Y = finiteOr(ySpread, 16);
  const rand = mulberry32(finiteOr(seed, 42));
  const out: DustSeed[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand();
    const v = rand();
    const theta = u * Math.PI * 2;
    const r = Math.max(0, R) * Math.sqrt(v);
    out[i] = {
      x: Math.cos(theta) * r,
      y: (rand() - 0.5) * Y,
      z: Math.sin(theta) * r,
      phase: rand() * Math.PI * 2,
      speed: 0.15 + rand() * 0.35,
      amp: 0.08 + rand() * 0.2,
      scale: 0.35 + rand() * 0.65,
    };
  }
  return out;
}

/**
 * Instanced cosmic dust. count clamped to [0, DUST_COUNT_MAX].
 * dispose() is idempotent; update() after dispose is a no-op.
 */
export function createDustField(scene: THREE.Scene, opts: CreateDustFieldOpts = {}): DustFieldHandle {
  const count = clampInt(opts.count ?? DUST_COUNT_DEFAULT, 0, DUST_COUNT_MAX, DUST_COUNT_DEFAULT);
  const radius = finiteOr(opts.radius ?? 28, 28);
  const ySpread = finiteOr(opts.ySpread ?? 16, 16);
  const seed = finiteOr(opts.seed ?? 42, 42);
  const size = Math.max(1e-4, finiteOr(opts.size ?? 0.09, 0.09));
  const color = finiteOr(opts.color ?? 0x7aa2ff, 0x7aa2ff);
  const seeds = seedDustParticles(count, radius, ySpread, seed);
  const clock = opts.clock ?? sharedMotionClock;

  const gustState: WindGustState = createWindGustState();
  const gustOut: WindGustSample = createWindGustSample();
  let gustReduced = false;

  const handle: DustFieldHandle = {
    mesh: null,
    count,
    disposed: false,
    lod: { active: count, camDistance: 0, budget: 1 },
    update: () => {},
    impulseGust: () => {},
    gust: gustOut,
    dispose: () => {},
  };

  handle.impulseGust = (dx, dy, dz, strength = 1) => {
    if (handle.disposed) return;
    impulseWindGust(gustState, dx, dy, dz, gustReduced, strength);
    // Reflect capped state immediately for callers that read handle.gust mid-frame.
    stepWindGust(gustState, gustOut, 0, gustReduced);
  };

  if (count === 0) {
    handle.dispose = () => {
      handle.disposed = true;
    };
    return handle;
  }

  const geo = new THREE.SphereGeometry(size, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const s = seeds[i]!;
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.setScalar(s.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  handle.mesh = mesh;

  const useLod = opts.lod !== false;
  const budget = createFrameBudget();
  let lastBudgetTime = Number.NaN;
  // The renderer hands us the real camera each draw — no scene wiring needed for LOD.
  mesh.onBeforeRender = (_r, _s, camera) => {
    const d = camera.position.length();
    if (Number.isFinite(d)) handle.lod.camDistance = d;
  };

  // Hacker c5: reduced-motion mid-session must not freeze a LOD-thinned field — snap to
  // full rest poses once, then idle. Cleared when motion resumes so LOD can thin again.
  let restPoseApplied = false;

  const writeRestPoses = () => {
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      handle.mesh!.setMatrixAt(i, dummy.matrix);
    }
    handle.lod.active = count;
    handle.mesh!.count = count;
    const im = handle.mesh!.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, count * 16);
    im.needsUpdate = true;
  };

  handle.update = (tSeconds: number, reducedMotion: boolean) => {
    if (handle.disposed || !handle.mesh) return;
    gustReduced = reducedMotion;
    if (reducedMotion) {
      stepWindGust(gustState, gustOut, 0, true);
      if (!restPoseApplied) {
        writeRestPoses();
        restPoseApplied = true;
      }
      return;
    }
    restPoseApplied = false;
    // Background tab: no CPU/GPU work; the motion clock absorbs the gap on resume.
    if (isDocumentHidden()) return;
    const t = clock.map(tSeconds);
    stepWindGust(gustState, gustOut, clock.lastWallDt, false);
    const gx = gustOut.x;
    const gy = gustOut.y;
    const gz = gustOut.z;
    let active = count;
    if (useLod) {
      if (t !== lastBudgetTime) {
        lastBudgetTime = t;
        handle.lod.budget = budget.sample(clock.lastWallDt);
      }
      active = lodCount(count, dustDistanceFactor(handle.lod.camDistance), handle.lod.budget);
    }
    handle.lod.active = active;
    handle.mesh.count = active;
    for (let i = 0; i < active; i++) {
      const s = seeds[i]!;
      const wobble = Math.sin(t * s.speed + s.phase) * s.amp;
      dummy.position.set(s.x + wobble * 0.4 + gx, s.y + wobble + gy, s.z - wobble * 0.25 + gz);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      handle.mesh!.setMatrixAt(i, dummy.matrix);
    }
    // Upload only the active slice (LOD) instead of the whole 2048×16 float buffer.
    const im = handle.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, active * 16);
    im.needsUpdate = true;
  };

  handle.dispose = () => {
    if (handle.disposed) return;
    handle.disposed = true;
    if (handle.mesh) {
      // Drop the LOD camera callback so an unmounted mesh cannot keep writing handle.lod.
      handle.mesh.onBeforeRender = () => {};
      scene.remove(handle.mesh);
      geo.dispose();
      mat.dispose();
      handle.mesh.dispose();
      handle.mesh = null;
    }
  };

  return handle;
}
