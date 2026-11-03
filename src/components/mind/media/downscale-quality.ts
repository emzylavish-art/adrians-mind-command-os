/** Client-side attach/camera downscale presets. Always canvas-reencode (EXIF strip). */

export type DownscaleQuality = "fast" | "balanced" | "full";

export const DOWNSCALE_QUALITY_STORAGE_KEY = "amcos.media.downscaleQuality.v1";

export type DownscaleQualityOptions = {
  maxEdge: number;
  /** JPEG quality ladder tried until under MAX_DATA_URL_CHARS. */
  jpegQualities: number[];
};

export function parseDownscaleQuality(value: unknown): DownscaleQuality {
  if (value === "fast" || value === "balanced" || value === "full") return value;
  return "balanced";
}

export function downscaleOptionsFor(quality: DownscaleQuality): DownscaleQualityOptions {
  switch (quality) {
    case "fast":
      return { maxEdge: 1280, jpegQualities: [0.72, 0.58, 0.45, 0.36] };
    case "full":
      // Still capped by MAX_IMAGE_EDGE / MAX_DATA_URL_CHARS in downscale.ts.
      return { maxEdge: 2048, jpegQualities: [0.92, 0.85, 0.72, 0.58] };
    case "balanced":
    default:
      return { maxEdge: 2048, jpegQualities: [0.85, 0.72, 0.58, 0.45] };
  }
}

export function loadDownscaleQuality(storage?: Pick<Storage, "getItem"> | null): DownscaleQuality {
  try {
    return parseDownscaleQuality(storage?.getItem(DOWNSCALE_QUALITY_STORAGE_KEY) ?? null);
  } catch {
    return "balanced";
  }
}

export function saveDownscaleQuality(
  quality: DownscaleQuality,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(DOWNSCALE_QUALITY_STORAGE_KEY, quality);
  } catch {
    /* private mode / quota — ignore */
  }
}

export function cycleDownscaleQuality(current: DownscaleQuality): DownscaleQuality {
  if (current === "fast") return "balanced";
  if (current === "balanced") return "full";
  return "fast";
}

export function downscaleQualityLabel(quality: DownscaleQuality): string {
  if (quality === "fast") return "Fast";
  if (quality === "full") return "Full";
  return "Balanced";
}
