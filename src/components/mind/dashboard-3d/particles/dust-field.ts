import * as THREE from "three";

export type DustFieldHandle = {
  mesh: THREE.InstancedMesh;
  count: number;
  /** Advance drift. No allocations. */
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type CreateDustFieldOpts = {
  count?: number;
  radius?: number;
  ySpread?: number;
  color?: number;
  seed?: number;
  /** Max pixel size hint via scale. */
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

/** Build seeded dust positions (pure; used by tests + createDustField). */
export function seedDustParticles(count: number, radius: number, ySpread: number, seed: number): DustSeed[] {
  const rand = mulberry32(seed);
  const out: DustSeed[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand();
    const theta = u * Math.PI * 2;
    const r = radius * Math.sqrt(v);
    out[i] = {
      x: Math.cos(theta) * r,
      y: (rand() - 0.5) * ySpread,
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
 * Instanced cosmic dust. One InstancedMesh, shared geometry/material.
 * update() reuses a single Object3D — no per-frame allocations.
 */
export function createDustField(scene: THREE.Scene, opts: CreateDustFieldOpts = {}): DustFieldHandle {
  const count = opts.count ?? 480;
  const radius = opts.radius ?? 28;
  const ySpread = opts.ySpread ?? 16;
  const seed = opts.seed ?? 42;
  const size = opts.size ?? 0.09;
  const color = opts.color ?? 0x7aa2ff;

  const seeds = seedDustParticles(count, radius, ySpread, seed);
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

  const update = (tSeconds: number, reducedMotion: boolean) => {
    if (reducedMotion) return; // leave seeded static pose
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      const wobble = Math.sin(tSeconds * s.speed + s.phase) * s.amp;
      dummy.position.set(s.x + wobble * 0.4, s.y + wobble, s.z - wobble * 0.25);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const dispose = () => {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    mesh.dispose();
  };

  return { mesh, count, update, dispose };
}
