import * as THREE from "three";
import { LaneNebulaShader } from "../shaders/lane-nebula.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import type { HealthTone } from "./ink-wash-edge.ts";
import { HEALTH_RGB } from "./ink-wash-edge.ts";
import type { PainterlyKit } from "./use-painterly-kit.ts";

export type LaneNebulaOptions = {
  health?: HealthTone | THREE.ColorRepresentation;
  opacity?: number;
  wash?: number;
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
  };
}

/** Health-tinted watercolor lane nebula (replaces MeshBasicMaterial tint spheres). */
export function createLaneNebulaMaterial(opts: LaneNebulaOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(LaneNebulaShader.uniforms);
  uniforms.uHealth.value.copy(resolveHealth(opts.health));
  if (opts.opacity != null) uniforms.uOpacity.value = sanitizeFinite(opts.opacity, 0.22, 0.02, 0.85);
  if (opts.wash != null) uniforms.uWash.value = sanitizeFinite(opts.wash, 0.65, 0, 2);
  return new THREE.ShaderMaterial({
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
  tick: (timeSeconds: number) => void;
  dispose: () => void;
  count: number;
};

function asTone(h: unknown): HealthTone {
  if (h === "healthy" || h === "stalled" || h === "blocked" || h === "idle") return h;
  return "idle";
}

function toArr(c: LaneNebulaInput["center"]): [number, number, number] {
  if (Array.isArray(c)) {
    return [
      sanitizeFinite(Number(c[0]), 0, -1e5, 1e5),
      sanitizeFinite(Number(c[1]), 0, -1e5, 1e5),
      sanitizeFinite(Number(c[2]), 0, -1e5, 1e5),
    ];
  }
  const o = c as { x: number; y: number; z: number };
  return [
    sanitizeFinite(Number(o.x), 0, -1e5, 1e5),
    sanitizeFinite(Number(o.y), 0, -1e5, 1e5),
    sanitizeFinite(Number(o.z), 0, -1e5, 1e5),
  ];
}

/**
 * One-call constellation lane nebulae for Dashboard Bot `rebuildNebulae`.
 *
 * ```ts
 * const neb = kit.createLaneNebulae(status.constellations.map(l => ({
 *   health: l.health, center: l.center,
 * })));
 * scene.add(neb.group);
 * // on poll: neb.update(...); cleanup: neb.dispose();
 * ```
 */
export function createPainterlyLaneNebulae(
  kit: PainterlyKit,
  lanes: LaneNebulaInput[] = [],
): PainterlyLaneNebulaeHandle {
  const group = new THREE.Group();
  group.name = "PainterlyLaneNebulae";
  const sharedGeo = new THREE.SphereGeometry(1, 24, 16);
  const mats: THREE.ShaderMaterial[] = [];
  const meshes: THREE.Mesh[] = [];
  let disposed = false;
  let count = 0;

  const clearMeshes = () => {
    for (const mesh of meshes) {
      group.remove(mesh);
      // geometry is shared — don't dispose per mesh
    }
    meshes.length = 0;
    for (const m of mats) {
      const i = kit.tracked.indexOf(m);
      if (i >= 0) kit.tracked.splice(i, 1);
      m.dispose();
    }
    mats.length = 0;
  };

  const update = (next: LaneNebulaInput[]) => {
    if (disposed) return;
    clearMeshes();
    const arr = Array.isArray(next) ? next : [];
    // Cap lanes — constellation count is small; hard cap for hostility
    const slice = arr.slice(0, 64);
    for (const lane of slice) {
      const tone = asTone(lane.health);
      const idle = tone === "idle";
      const opacity =
        lane.opacity != null
          ? sanitizeFinite(lane.opacity, idle ? 0.08 : 0.28, 0.02, 0.85)
          : idle
            ? 0.1
            : 0.32;
      const mat = createLaneNebulaMaterial({ health: tone, opacity });
      kit.tracked.push(mat);
      mats.push(mat);
      const mesh = new THREE.Mesh(sharedGeo, mat);
      const [x, y, z] = toArr(lane.center);
      const radius = sanitizeFinite(lane.radius ?? 2.4, 2.4, 0.2, 40);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(radius);
      mesh.renderOrder = -1;
      mesh.frustumCulled = true;
      if (lane.id) mesh.userData.laneId = lane.id;
      group.add(mesh);
      meshes.push(mesh);
    }
    count = meshes.length;
  };

  const tick = (t: number) => {
    if (disposed) return;
    for (const m of mats) tickLaneNebulaMaterial(m, t);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearMeshes();
    sharedGeo.dispose();
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
  };
}
