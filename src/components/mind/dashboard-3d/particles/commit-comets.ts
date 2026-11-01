import * as THREE from "three";

export type CommitTrailInput = {
  sha: string;
  subject?: string;
};

export type CommitCometsHandle = {
  group: THREE.Group;
  count: number;
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type CreateCommitCometsOpts = {
  /** Max comets (LOD). Default 6. */
  max?: number;
  /** Arc radius. */
  radius?: number;
  /** Trail point count per comet. */
  segments?: number;
};

type CometState = {
  phase: number;
  speed: number;
  incline: number;
  yaw: number;
  color: number;
  line: THREE.Line;
  positions: Float32Array;
};

function hashHue(sha: string): number {
  let h = 0;
  for (let i = 0; i < sha.length; i++) h = (h * 33 + sha.charCodeAt(i)) | 0;
  return (h >>> 0) % 360;
}

/**
 * Commit → comet trails. Thin Line geometries with preallocated position buffers.
 * Prefer feeding real `status.commits` — never fabricate SHAs.
 */
export function createCommitComets(
  scene: THREE.Scene,
  commits: readonly CommitTrailInput[],
  opts: CreateCommitCometsOpts = {},
): CommitCometsHandle {
  const max = opts.max ?? 6;
  const radius = opts.radius ?? 14;
  const segments = opts.segments ?? 24;
  const group = new THREE.Group();
  group.name = "motion-commit-comets";
  scene.add(group);

  const list = commits.slice(0, max);
  const comets: CometState[] = [];

  list.forEach((c, i) => {
    const positions = new Float32Array(segments * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const hue = hashHue(c.sha || String(i));
    const color = new THREE.Color(`hsl(${hue}, 70%, 65%)`);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    group.add(line);
    comets.push({
      phase: i * 1.7,
      speed: 0.22 + (i % 3) * 0.05,
      incline: 0.25 + (i % 4) * 0.08,
      yaw: (i / Math.max(list.length, 1)) * Math.PI * 2,
      color: color.getHex(),
      line,
      positions,
    });
  });

  const writeArc = (c: CometState, head: number) => {
    const pos = c.positions;
    for (let s = 0; s < segments; s++) {
      const u = s / (segments - 1);
      const ang = head - u * 0.85;
      const r = radius * (0.85 + 0.15 * Math.sin(ang * 0.5 + c.phase));
      const x = Math.cos(ang + c.yaw) * r;
      const z = Math.sin(ang + c.yaw) * r;
      const y = Math.sin(ang * c.incline + c.phase) * (radius * 0.22);
      const o = s * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
    }
    const attr = c.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  };

  // Initial static pose
  for (const c of comets) writeArc(c, c.phase);

  const update = (tSeconds: number, reducedMotion: boolean) => {
    if (reducedMotion) {
      for (const c of comets) {
        (c.line.material as THREE.LineBasicMaterial).opacity = 0.28;
      }
      return;
    }
    for (const c of comets) {
      (c.line.material as THREE.LineBasicMaterial).opacity = 0.55;
      writeArc(c, tSeconds * c.speed + c.phase);
    }
  };

  const dispose = () => {
    for (const c of comets) {
      group.remove(c.line);
      c.line.geometry.dispose();
      (c.line.material as THREE.Material).dispose();
    }
    scene.remove(group);
  };

  return { group, count: comets.length, update, dispose };
}
