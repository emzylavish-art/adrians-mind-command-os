import * as THREE from "three";
import { clampInt, finiteOr, sanitizeTime } from "../motion/sanitize.ts";

export const DUST_COUNT_MAX = 2048;
export const DUST_COUNT_DEFAULT = 480;

export type DustFieldHandle = {
  mesh: THREE.InstancedMesh | null;
  count: number;
  disposed: boolean;
  /** Advance drift. No allocations. Safe after dispose (no-op). */
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type CreateDustFieldOpts = {
  count?: number;
  radius?: number;
  ySpread?: number;
  color?: number;
  seed?: number;
  size?: number;
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

  const handle: DustFieldHandle = {
    mesh: null,
    count,
    disposed: false,
    update: () => {},
    dispose: () => {},
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

  handle.update = (tSeconds: number, reducedMotion: boolean) => {
    if (handle.disposed || reducedMotion || !handle.mesh) return;
    const t = sanitizeTime(tSeconds);
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      const wobble = Math.sin(t * s.speed + s.phase) * s.amp;
      dummy.position.set(s.x + wobble * 0.4, s.y + wobble, s.z - wobble * 0.25);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      handle.mesh!.setMatrixAt(i, dummy.matrix);
    }
    handle.mesh.instanceMatrix.needsUpdate = true;
  };

  handle.dispose = () => {
    if (handle.disposed) return;
    handle.disposed = true;
    if (handle.mesh) {
      scene.remove(handle.mesh);
      geo.dispose();
      mat.dispose();
      handle.mesh.dispose();
      handle.mesh = null;
    }
  };

  return handle;
}
