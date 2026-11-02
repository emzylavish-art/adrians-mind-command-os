import * as THREE from "three";
import { focusRigPlacement, type Vec3Like } from "./focus-light.ts";

/**
 * Imagine portrait colour bounce (light lane, queue #60; builds on #56 focus light).
 *
 * While a node is focused, a LOW-intensity fill light ("bounce") sits between
 * the camera and the focused node, slightly below, tinted from the focused
 * Imagine portrait's REAL average colour — sampled from the loaded texture
 * pixels — so scene lighting picks up the artwork's palette.
 *
 * Honesty rules:
 * - No texture / not loaded yet / tainted canvas / fully transparent → NEUTRAL
 *   white fill (never an invented colour). Sample failures are recorded on
 *   `lastSampleError` (never silent).
 * - Averages are cached per texture (+ texture.version) so a focus hold costs
 *   one 16×16 readback, not one per frame.
 * - Reduced motion snaps level + colour (static).
 */

export const BOUNCE_EASE_MS = 420;
/** Kept well under the #56 key (12) / rim (14) so it fills, never relights. */
export const BOUNCE_INTENSITY = 3.2;
/** How much of the portrait chroma survives (rest is neutral) — subtle fill. */
export const BOUNCE_CHROMA = 0.65;
/** Sample grid edge (pixels) for the average. */
export const BOUNCE_SAMPLE_EDGE = 16;
/** Pixels with alpha below this (0..255) are ignored (transparent card margins). */
export const BOUNCE_ALPHA_MIN = 16;
export const NEUTRAL_BOUNCE_RGB: readonly [number, number, number] = [1, 1, 1];

export type Rgb3 = [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Average linear RGB of RGBA8 pixels (sRGB-encoded). Alpha-weighted; pixels
 * under BOUNCE_ALPHA_MIN skipped. Junk / no opaque pixels → null.
 */
export function averageLinearRgb(
  data: ArrayLike<number> | null | undefined,
  width: number,
  height: number,
): Rgb3 | null {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const n = width * height;
  if (data.length < n * 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3]!;
    if (!(a >= BOUNCE_ALPHA_MIN)) continue;
    const wa = a / 255;
    const pr = data[i * 4]!;
    const pg = data[i * 4 + 1]!;
    const pb = data[i * 4 + 2]!;
    if (![pr, pg, pb].every(Number.isFinite)) continue;
    r += srgbToLinear(pr / 255) * wa;
    g += srgbToLinear(pg / 255) * wa;
    b += srgbToLinear(pb / 255) * wa;
    w += wa;
  }
  if (w <= 0) return null;
  return [r / w, g / w, b / w];
}

/**
 * Light colour from a portrait average: normalise to max channel 1 (keeps hue,
 * drops the artwork's darkness — intensity is ours), then mix BOUNCE_CHROMA of
 * that hue with neutral. Null / black / junk → neutral.
 */
export function bounceRgbFromAverage(avg: readonly number[] | null | undefined): Rgb3 {
  if (!avg || avg.length < 3 || !avg.slice(0, 3).every((v) => Number.isFinite(v) && v >= 0)) {
    return [...NEUTRAL_BOUNCE_RGB] as Rgb3;
  }
  const m = Math.max(avg[0]!, avg[1]!, avg[2]!);
  if (m < 1e-4) return [...NEUTRAL_BOUNCE_RGB] as Rgb3;
  return [0, 1, 2].map((i) => 1 - BOUNCE_CHROMA + BOUNCE_CHROMA * (avg[i]! / m)) as Rgb3;
}

/** Read the loaded portrait from an Imagine node material (uImage when uHasImage=1). */
export function portraitTextureOf(material: unknown): THREE.Texture | null {
  const u = (material as { uniforms?: Record<string, { value: unknown }> } | null)?.uniforms;
  if (!u || u["uHasImage"]?.value !== 1) return null;
  const tex = u["uImage"]?.value as THREE.Texture | null | undefined;
  return tex && (tex as THREE.Texture).isTexture ? tex : null;
}

type PixelSource = { width: number; height: number } & object;

/** Drawable image with real pixels (HTMLImageElement complete, bitmap, canvas, video ready). */
export function readyImageSize(image: unknown): { width: number; height: number } | null {
  if (!image || typeof image !== "object") return null;
  const img = image as {
    complete?: boolean;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
    readyState?: number;
  };
  if (img.complete === false) return null;
  if (typeof img.readyState === "number" && img.readyState < 2) return null;
  const w = img.naturalWidth || img.videoWidth || img.width || 0;
  const h = img.naturalHeight || img.videoHeight || img.height || 0;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** Downsample surface (injectable for tests / non-DOM). Returns RGBA8 of edge×edge. */
export type PixelReader = (image: PixelSource, edge: number) => ArrayLike<number>;

export const domPixelReader: PixelReader = (image, edge) => {
  const g = globalThis as { OffscreenCanvas?: typeof OffscreenCanvas; document?: Document };
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  if (typeof g.OffscreenCanvas === "function") {
    ctx = new g.OffscreenCanvas(edge, edge).getContext("2d", { willReadFrequently: true });
  } else if (g.document) {
    const c = g.document.createElement("canvas");
    c.width = edge;
    c.height = edge;
    ctx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) throw new Error("no-2d-context");
  ctx.drawImage(image as CanvasImageSource, 0, 0, edge, edge);
  return ctx.getImageData(0, 0, edge, edge).data; // throws SecurityError on tainted (CORS) art
};

/**
 * Average colour of a texture's REAL pixels. Supports raw DataTexture-like
 * `image.data` (RGBA8) directly; otherwise downsamples via `reader`.
 * Not loaded → { rgb: null, error: null }; failure → { rgb: null, error }.
 */
export function sampleTextureAverage(
  texture: THREE.Texture | null | undefined,
  reader: PixelReader = domPixelReader,
): { rgb: Rgb3 | null; error: string | null } {
  if (!texture) return { rgb: null, error: null };
  const image = texture.image as unknown;
  const raw = image as { data?: ArrayLike<number>; width?: number; height?: number } | null;
  if (raw && raw.data && typeof raw.width === "number" && typeof raw.height === "number") {
    if (raw.data.length !== raw.width * raw.height * 4 || !(raw.data instanceof Uint8Array || raw.data instanceof Uint8ClampedArray)) {
      return { rgb: null, error: "unsupported-data-format" };
    }
    return { rgb: averageLinearRgb(raw.data, raw.width, raw.height), error: null };
  }
  const size = readyImageSize(image);
  if (!size) return { rgb: null, error: null };
  try {
    const px = reader(image as PixelSource, BOUNCE_SAMPLE_EDGE);
    return { rgb: averageLinearRgb(px, BOUNCE_SAMPLE_EDGE, BOUNCE_SAMPLE_EDGE), error: null };
  } catch (e) {
    return { rgb: null, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/** Bounce sits camera-side, below the node: 55% toward the key offset, dropped. */
export function bouncePlacement(position: Vec3Like, camera: Vec3Like): [number, number, number] | null {
  const place = focusRigPlacement(position, camera);
  if (!place) return null;
  const p = Array.isArray(position)
    ? (position as readonly number[])
    : [(position as { x: number }).x, (position as { y: number }).y, (position as { z: number }).z];
  const [kx, ky, kz] = place.key;
  // Mirror the key's lift downward and pull it toward the node (fill from below).
  return [p[0]! + (kx - p[0]!) * 0.35, p[1]! - Math.abs(ky - p[1]!) * 0.6, p[2]! + (kz - p[2]!) * 0.7];
}

export type PortraitBounceInput = {
  position: Vec3Like;
  camera: Vec3Like;
  /** Loaded portrait (see portraitTextureOf). Null → neutral fill. */
  texture?: THREE.Texture | null;
};

export type PortraitBounceHandle = {
  light: THREE.PointLight;
  readonly level: number;
  /** Current target colour (neutral when no real sample). */
  readonly rgb: Rgb3;
  /** True when the colour came from real portrait pixels. */
  readonly sampled: boolean;
  /** Sample failure for the CURRENT focus (tainted canvas, no 2D context…) or null. */
  readonly lastSampleError: string | null;
  setFocus: (input: PortraitBounceInput | null, opts?: { reducedMotion?: boolean }) => void;
  tick: (dtMs: number) => void;
  dispose: () => void;
};

export function createPortraitBounce(
  scene: THREE.Scene,
  opts: { reader?: PixelReader } = {},
): PortraitBounceHandle {
  const reader = opts.reader ?? domPixelReader;
  const light = new THREE.PointLight(0xffffff, 0, 9, 2);
  light.visible = false;
  light.name = "light:portrait-bounce";
  scene.add(light);

  const cache = new WeakMap<THREE.Texture, { version: number; rgb: Rgb3 | null; error: string | null }>();
  let disposed = false;
  let level = 0;
  let target = 0;
  let from = 0;
  let elapsed = BOUNCE_EASE_MS;
  let reduced = false;
  let sampled = false;
  let lastSampleError: string | null = null;
  const cur = new THREE.Color(1, 1, 1);
  const fromCol = new THREE.Color(1, 1, 1);
  const toCol = new THREE.Color(1, 1, 1);
  let colElapsed = BOUNCE_EASE_MS;

  // HACKER (#68 cycle): lastSampleError describes the CURRENT focus — cleared on a
  // real sample / no texture, re-surfaced from cache for a known-bad portrait.
  // (It used to stick forever after one tainted portrait.)
  const averageFor = (tex: THREE.Texture | null | undefined): Rgb3 | null => {
    if (!tex) {
      lastSampleError = null;
      return null;
    }
    const hit = cache.get(tex);
    if (hit && hit.version === tex.version) {
      lastSampleError = hit.error;
      return hit.rgb;
    }
    const r = sampleTextureAverage(tex, reader);
    lastSampleError = r.error;
    // Only cache definitive answers (not "image still loading").
    if (r.rgb || r.error || readyImageSize(tex.image)) {
      cache.set(tex, { version: tex.version, rgb: r.rgb, error: r.error });
    }
    return r.rgb;
  };

  const apply = () => {
    light.intensity = BOUNCE_INTENSITY * level;
    light.color.copy(cur);
    light.visible = !disposed && level > 0.001;
  };

  return {
    light,
    get level() {
      return disposed ? 0 : level;
    },
    get rgb() {
      return [toCol.r, toCol.g, toCol.b] as Rgb3;
    },
    get sampled() {
      return sampled;
    },
    get lastSampleError() {
      return lastSampleError;
    },
    setFocus(input, o = {}) {
      if (disposed) return;
      reduced = !!o.reducedMotion;
      const place = input ? bouncePlacement(input.position, input.camera) : null;
      const next = place ? 1 : 0;
      if (place && input) {
        light.position.set(...place);
        const avg = averageFor(input.texture);
        sampled = !!avg;
        const rgb = bounceRgbFromAverage(avg);
        if (Math.abs(rgb[0] - toCol.r) + Math.abs(rgb[1] - toCol.g) + Math.abs(rgb[2] - toCol.b) > 1e-4) {
          fromCol.copy(cur);
          toCol.setRGB(rgb[0], rgb[1], rgb[2]);
          colElapsed = level > 0.001 ? 0 : BOUNCE_EASE_MS; // fading in: start at the right colour
          if (colElapsed >= BOUNCE_EASE_MS) cur.copy(toCol);
        }
      }
      if (next !== target) {
        from = level;
        target = next;
        elapsed = 0;
      }
      if (reduced) {
        level = target;
        elapsed = BOUNCE_EASE_MS;
        colElapsed = BOUNCE_EASE_MS;
        cur.copy(toCol);
      }
      apply();
    },
    tick(dtMs) {
      if (disposed) return;
      const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
      const ease = (t: number) => t * t * (3 - 2 * t);
      if (reduced || elapsed >= BOUNCE_EASE_MS) level = target;
      else {
        elapsed = Math.min(BOUNCE_EASE_MS, elapsed + dt);
        level = from + (target - from) * ease(elapsed / BOUNCE_EASE_MS);
      }
      if (reduced || colElapsed >= BOUNCE_EASE_MS) cur.copy(toCol);
      else {
        colElapsed = Math.min(BOUNCE_EASE_MS, colElapsed + dt);
        cur.copy(fromCol).lerp(toCol, ease(colElapsed / BOUNCE_EASE_MS));
      }
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      level = 0;
      apply();
      scene.remove(light);
      light.dispose();
    },
  };
}
