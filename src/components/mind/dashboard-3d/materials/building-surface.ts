import * as THREE from "three";
import { BrushBuildingShader } from "../shaders/brush-building.ts";
import { sanitizeFinite, sanitizeShaderTime } from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type BuildingSurfaceOptions = {
  base?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  floors?: number;
  /** Real litFloors/floors in [0,1] — never fabricate occupancy. */
  progress?: number;
  paper?: number;
  /** Window wash strength; defaults from progress (0 progress → dark). */
  windowGlow?: number;
  /** Dry-brush strength; defaults from progress (0 when unknown). */
  dryBrush?: number;
  /**
   * HACKER (c17): force identity-tint fallback (WebGL1 / known-bad GLSL).
   * Records `userData.painterMaterialMeta.compileError` — never silent black.
   */
  forceFallback?: boolean;
};

export type BuildingPainterMaterialMeta = {
  compileError: string | null;
  fallback: boolean;
};

/** Soft cap for shared building mat pools (progress buckets). */
export const BUILDING_BRUSH_POOL_MAX = 8;

/** Map real progress → dry-brush strength (neutral 0 when progress≤0). */
export function buildingDryBrushFromProgress(progress: number): number {
  const p = sanitizeFinite(progress, 0, 0, 1);
  if (p <= 0) return 0;
  // Mild ramp: early floors get light scumble; full progress → stronger strokes
  return sanitizeFinite(0.12 + p * 0.72, 0, 0, 1);
}

function cloneUniforms(src: typeof BrushBuildingShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uAccent: { value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]) },
    uFloors: { value: src.uFloors.value as number },
    uProgress: { value: src.uProgress.value as number },
    uTime: { value: 0 },
    uPaper: { value: src.uPaper.value as number },
    uWindowGlow: { value: src.uWindowGlow.value as number },
    uDryBrush: { value: src.uDryBrush.value as number },
  };
}

function buildingFallbackMaterial(
  base: THREE.Color,
  accent: THREE.Color,
  reason: string,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: "BuildingBrushMaterialFallback",
    uniforms: {
      uBase: { value: base.clone() },
      uAccent: { value: accent.clone() },
      uFloors: { value: 8 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uPaper: { value: 0 },
      uWindowGlow: { value: 0 },
      uDryBrush: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uAccent;
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        float lit = step(vUv.y, clamp(uProgress, 0.0, 1.0));
        vec3 c = mix(uBase, mix(uBase, uAccent, 0.55), lit * 0.65);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
    precision: PAINTER_SHADER_PRECISION,
  });
  mat.userData.painterMaterialMeta = {
    compileError: reason,
    fallback: true,
  } satisfies BuildingPainterMaterialMeta;
  return mat;
}

/**
 * Brush/watercolor ShaderMaterial for project buildings (city flyover).
 * HACKER (c17): construct failure → visible fallback (not silent black / throw).
 */
export function createBuildingBrushMaterial(
  opts: BuildingSurfaceOptions = {},
): THREE.ShaderMaterial {
  const base = new THREE.Color(opts.base ?? 0x121a30);
  const accent = new THREE.Color(opts.accent ?? 0x7dc8ff);
  if (opts.forceFallback) {
    const fb = buildingFallbackMaterial(base, accent, "forceFallback");
    applyBuildingOpts(fb, opts);
    return fb;
  }
  try {
    if (!BrushBuildingShader.vertexShader?.trim() || !BrushBuildingShader.fragmentShader?.trim()) {
      throw new Error("building-shader-empty");
    }
    if (!BrushBuildingShader.fragmentShader.includes("uDryBrush")) {
      throw new Error("building-shader-preflight-failed");
    }
    const uniforms = cloneUniforms(BrushBuildingShader.uniforms);
    uniforms.uBase.value.copy(base);
    uniforms.uAccent.value.copy(accent);
    applyUniformOpts(uniforms, opts);
    const mat = new THREE.ShaderMaterial({
      name: "BuildingBrushMaterial",
      precision: PAINTER_SHADER_PRECISION,
      uniforms,
      vertexShader: BrushBuildingShader.vertexShader,
      fragmentShader: BrushBuildingShader.fragmentShader,
    });
    mat.userData.painterMaterialMeta = {
      compileError: null,
      fallback: false,
    } satisfies BuildingPainterMaterialMeta;
    return mat;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fb = buildingFallbackMaterial(base, accent, reason);
    applyBuildingOpts(fb, opts);
    return fb;
  }
}

function applyUniformOpts(
  uniforms: ReturnType<typeof cloneUniforms>,
  opts: BuildingSurfaceOptions,
): void {
  if (opts.floors != null) uniforms.uFloors.value = sanitizeFinite(opts.floors, 8, 1, 128);
  if (opts.progress != null) uniforms.uProgress.value = sanitizeFinite(opts.progress, 0, 0, 1);
  if (opts.paper != null) uniforms.uPaper.value = sanitizeFinite(opts.paper, 0.18, 0, 1);
  const progressVal = uniforms.uProgress.value as number;
  if (opts.windowGlow != null) {
    uniforms.uWindowGlow.value = sanitizeFinite(opts.windowGlow, progressVal > 0 ? 0.85 : 0, 0, 1.5);
  } else {
    uniforms.uWindowGlow.value =
      progressVal > 0 ? sanitizeFinite(0.55 + progressVal * 0.55, 0.85, 0, 1.5) : 0;
  }
  if (opts.dryBrush != null) {
    uniforms.uDryBrush.value = sanitizeFinite(opts.dryBrush, 0, 0, 1);
  } else {
    uniforms.uDryBrush.value = buildingDryBrushFromProgress(progressVal);
  }
}

function applyBuildingOpts(mat: THREE.ShaderMaterial, opts: BuildingSurfaceOptions): void {
  if (opts.floors != null && mat.uniforms["uFloors"]) {
    mat.uniforms["uFloors"].value = sanitizeFinite(opts.floors, 8, 1, 128);
  }
  if (opts.progress != null) setBuildingProgress(mat, opts.progress);
  else if (opts.dryBrush != null) setBuildingDryBrush(mat, opts.dryBrush);
  if (opts.windowGlow != null) setBuildingWindowGlow(mat, opts.windowGlow);
  if (opts.paper != null && mat.uniforms["uPaper"]) {
    mat.uniforms["uPaper"].value = sanitizeFinite(opts.paper, 0.18, 0, 1);
  }
}

export function tickBuildingMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) {
    mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
  }
}

/**
 * Hot path — MUST NOT allocate. Safe at 60Hz from city.applyBuildingProgress.
 * Updates progress, window glow (unless locked), and dry-brush (unless locked).
 */
export function setBuildingProgress(mat: THREE.ShaderMaterial, progress: number): void {
  const p = sanitizeFinite(progress, 0, 0, 1);
  if (mat.uniforms["uProgress"]) mat.uniforms["uProgress"].value = p;
  const ud = mat.userData as {
    windowGlowLocked?: boolean;
    dryBrushLocked?: boolean;
  };
  if (mat.uniforms["uWindowGlow"] && !ud.windowGlowLocked) {
    mat.uniforms["uWindowGlow"].value = p > 0 ? sanitizeFinite(0.55 + p * 0.55, 0.85, 0, 1.5) : 0;
  }
  if (mat.uniforms["uDryBrush"] && !ud.dryBrushLocked) {
    mat.uniforms["uDryBrush"].value = buildingDryBrushFromProgress(p);
  }
}

/** Explicit window wash; locks auto-sync from setBuildingProgress. */
export function setBuildingWindowGlow(mat: THREE.ShaderMaterial, glow: number): void {
  if (mat.uniforms["uWindowGlow"]) {
    mat.uniforms["uWindowGlow"].value = sanitizeFinite(glow, 0, 0, 1.5);
  }
  (mat.userData as { windowGlowLocked?: boolean }).windowGlowLocked = true;
}

/** Explicit dry-brush; locks auto-sync from setBuildingProgress. */
export function setBuildingDryBrush(mat: THREE.ShaderMaterial, dry: number): void {
  if (mat.uniforms["uDryBrush"]) {
    mat.uniforms["uDryBrush"].value = sanitizeFinite(dry, 0, 0, 1);
  }
  (mat.userData as { dryBrushLocked?: boolean }).dryBrushLocked = true;
}

/* ---------- Shared pool: ≤ BUILDING_BRUSH_POOL_MAX mats for thousands of buildings ---------- */

export type BuildingBrushPool = {
  /** Pick shared mat for a progress value (quantized). */
  materialForProgress: (progress: number) => THREE.ShaderMaterial;
  /** Update all bucket mats from a list of real progresses (no per-building mat). */
  syncFromProgresses: (progresses: number[]) => void;
  dispose: () => void;
  materialCount: number;
  bucketCount: number;
};

/**
 * HACKER (c17): one ShaderMaterial per building OOMs / stalls WebGL at city scale.
 * Share ≤ BUILDING_BRUSH_POOL_MAX materials quantized by progress.
 * Dashboard/city can adopt instead of per-building createBuildingBrushMaterial.
 */
export function createBuildingBrushPool(
  opts: Omit<BuildingSurfaceOptions, "progress" | "dryBrush" | "windowGlow"> & {
    buckets?: number;
  } = {},
): BuildingBrushPool {
  const n = Math.max(
    1,
    Math.min(BUILDING_BRUSH_POOL_MAX, Math.floor(sanitizeFinite(opts.buckets ?? 8, 8, 1, BUILDING_BRUSH_POOL_MAX))),
  );
  const mats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < n; i++) {
    const progress = n === 1 ? 0 : i / (n - 1);
    mats.push(
      createBuildingBrushMaterial({
        ...opts,
        progress,
        floors: opts.floors ?? 8,
      }),
    );
  }
  let disposed = false;
  /** HACKER (c18): after dispose, materialForProgress must not return undefined (mesh.material crash). */
  let tombstone: THREE.ShaderMaterial | null = null;
  const ensureTombstone = (): THREE.ShaderMaterial => {
    if (tombstone && !(tombstone as { disposed?: boolean }).disposed) return tombstone;
    tombstone = createBuildingBrushMaterial({
      ...opts,
      progress: 0,
      floors: opts.floors ?? 8,
      dryBrush: 0,
      windowGlow: 0,
    });
    (tombstone.userData as { buildingPoolTombstone?: boolean }).buildingPoolTombstone = true;
    return tombstone;
  };
  const materialForProgress = (progress: number) => {
    if (disposed || mats.length === 0) return ensureTombstone();
    const p = sanitizeFinite(progress, 0, 0, 1);
    const idx = n === 1 ? 0 : Math.min(n - 1, Math.round(p * (n - 1)));
    const mat = mats[idx];
    if (!mat || (mat as { disposed?: boolean }).disposed) return ensureTombstone();
    return mat;
  };
  const syncFromProgresses = (progresses: number[]) => {
    if (disposed || mats.length === 0) return;
    // Average progress per bucket from real inputs; empty bucket → 0
    const sums = new Float64Array(n);
    const counts = new Int32Array(n);
    const arr = Array.isArray(progresses) ? progresses : [];
    for (let i = 0; i < arr.length; i++) {
      const p = sanitizeFinite(arr[i]!, 0, 0, 1);
      const idx = n === 1 ? 0 : Math.min(n - 1, Math.round(p * (n - 1)));
      sums[idx]! += p;
      counts[idx]! += 1;
    }
    for (let i = 0; i < n; i++) {
      const avg = counts[i]! > 0 ? sums[i]! / counts[i]! : i / Math.max(1, n - 1);
      const mat = mats[i];
      if (!mat || (mat as { disposed?: boolean }).disposed) continue;
      setBuildingProgress(mat, counts[i]! > 0 ? avg : 0);
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const m of mats) {
      try {
        m.dispose();
      } catch {
        /* */
      }
    }
    mats.length = 0;
    if (tombstone) {
      try {
        tombstone.dispose();
      } catch {
        /* */
      }
      tombstone = null;
    }
  };
  return {
    materialForProgress,
    syncFromProgresses,
    dispose,
    get materialCount() {
      return mats.length;
    },
    get bucketCount() {
      return n;
    },
  };
}
