import * as THREE from "three";
import { clampInt, finiteOr } from "../motion/sanitize.ts";
import { sharedMotionClock, type MotionClock } from "../motion/motion-clock.ts";
import { isDocumentHidden } from "./motion-lod.ts";

export const COMET_SEGMENTS_MIN = 2;
export const COMET_SEGMENTS_DEFAULT = 24;
export const COMET_MAX_DEFAULT = 6;
export const COMET_MAX_HARD = 24;

export type CommitTrailInput = {
  sha?: string | null;
  subject?: string;
};

export type CommitCometsHandle = {
  group: THREE.Group;
  count: number;
  disposed: boolean;
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type CreateCommitCometsOpts = {
  max?: number;
  radius?: number;
  segments?: number;
  /** Continuous clock (default shared) — survives the scene's 5s comet rebuild. */
  clock?: MotionClock;
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
 * Commit → comet trails. segments clamped ≥2 (avoids /0 → NaN arcs).
 * dispose() idempotent; update() after dispose is a no-op.
 * Skips commits with empty/missing sha rather than fabricating.
 */
export function createCommitComets(
  scene: THREE.Scene,
  commits: readonly CommitTrailInput[] | null | undefined,
  opts: CreateCommitCometsOpts = {},
): CommitCometsHandle {
  const max = clampInt(opts.max ?? COMET_MAX_DEFAULT, 0, COMET_MAX_HARD, COMET_MAX_DEFAULT);
  const radius = Math.max(0.01, finiteOr(opts.radius ?? 14, 14));
  const segments = clampInt(opts.segments ?? COMET_SEGMENTS_DEFAULT, COMET_SEGMENTS_MIN, 128, COMET_SEGMENTS_DEFAULT);
  const clock = opts.clock ?? sharedMotionClock;
  const group = new THREE.Group();
  group.name = "motion-commit-comets";
  scene.add(group);

  const raw = Array.isArray(commits) ? commits : [];
  const list = raw
    .filter((c) => c && typeof c.sha === "string" && c.sha.length > 0)
    .slice(0, max);

  const comets: CometState[] = [];
  const handle: CommitCometsHandle = {
    group,
    count: 0,
    disposed: false,
    update: () => {},
    dispose: () => {},
  };

  list.forEach((c, i) => {
    const positions = new Float32Array(segments * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const hue = hashHue(c.sha!);
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
  handle.count = comets.length;

  const writeArc = (c: CometState, head: number) => {
    const pos = c.positions;
    const denom = segments - 1; // >= 1 by clamp
    for (let s = 0; s < segments; s++) {
      const u = s / denom;
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

  for (const c of comets) writeArc(c, c.phase);

  handle.update = (tSeconds: number, reducedMotion: boolean) => {
    if (handle.disposed) return;
    if (reducedMotion) {
      for (const c of comets) {
        (c.line.material as THREE.LineBasicMaterial).opacity = 0.28;
      }
      return;
    }
    if (isDocumentHidden()) return;
    const t = clock.map(tSeconds);
    for (const c of comets) {
      (c.line.material as THREE.LineBasicMaterial).opacity = 0.55;
      writeArc(c, t * c.speed + c.phase);
    }
  };

  handle.dispose = () => {
    if (handle.disposed) return;
    handle.disposed = true;
    for (const c of comets) {
      group.remove(c.line);
      c.line.geometry.dispose();
      (c.line.material as THREE.Material).dispose();
    }
    comets.length = 0;
    scene.remove(group);
  };

  return handle;
}
