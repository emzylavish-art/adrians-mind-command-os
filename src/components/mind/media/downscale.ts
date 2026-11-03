import { dimensionsLookLikeBomb, fitWithinBox, guessMimeFromName, MAX_DATA_URL_CHARS, MAX_IMAGE_EDGE, sanitizeMediaLabel, sniffImageMimeFromBase64 } from "@/lib/mind/media";
import {
  downscaleOptionsFor,
  type DownscaleQuality,
  type DownscaleQualityOptions,
} from "./downscale-quality";

export type DownscaleResult = {
  dataUrl: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  scaled: boolean;
};

export type DownscaleCallOptions = Partial<DownscaleQualityOptions> & {
  quality?: DownscaleQuality;
};

function resolveOptions(options?: DownscaleCallOptions | number): DownscaleQualityOptions & { maxEdge: number } {
  // Back-compat: second arg used to be maxEdge number.
  if (typeof options === "number") {
    return { ...downscaleOptionsFor("balanced"), maxEdge: options };
  }
  const preset = downscaleOptionsFor(options?.quality ?? "balanced");
  return {
    maxEdge: Math.min(options?.maxEdge ?? preset.maxEdge, MAX_IMAGE_EDGE),
    jpegQualities: options?.jpegQualities ?? preset.jpegQualities,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read that image file."));
    };
    reader.readAsDataURL(file);
  });
}

async function loadImageBitmap(dataUrl: string): Promise<ImageBitmap | HTMLImageElement> {
  // Prefer createImageBitmap so EXIF orientation is applied before we strip metadata via canvas.
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    }
  } catch {
    /* fall through */
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = dataUrl;
  });
}

function bitmapSize(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ("naturalWidth" in image) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: image.width, height: image.height };
}

/** Downscale a File or data-URL to max edge as JPEG/PNG data-URL (canvas redraw strips EXIF). */
export async function fileToDownscaledDataUrl(
  file: File,
  options?: DownscaleCallOptions | number,
): Promise<DownscaleResult> {
  if (!file || file.size === 0) {
    throw new Error("That file is empty.");
  }
  const type = (file.type || "").toLowerCase();
  if (type && !type.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }
  if (type.includes("heic") || type.includes("heif") || type.includes("avif") || /\.heic$|\.heif$|\.avif$/i.test(file.name)) {
    throw new Error("HEIC/AVIF is not supported here. Convert to JPEG or PNG first.");
  }
  const source = await readFileAsDataUrl(file);
  const comma = source.indexOf(",");
  const b64 = comma >= 0 ? source.slice(comma + 1) : "";
  const sniffed = sniffImageMimeFromBase64(b64);
  if (!sniffed) {
    throw new Error("That file is not a real PNG/JPEG/GIF/WebP image (bytes did not match).");
  }
  const resolved = resolveOptions(options);
  const safeName = sanitizeMediaLabel(file.name) || (sniffed === "image/png" ? "image.png" : sniffed === "image/webp" ? "image.webp" : sniffed === "image/gif" ? "image.gif" : "image.jpg");
  return dataUrlToDownscaled(`data:${sniffed};base64,${b64}`, safeName, resolved);
}

export async function dataUrlToDownscaled(
  dataUrl: string,
  name = "image.jpg",
  options?: DownscaleCallOptions | number,
): Promise<DownscaleResult> {
  const resolved = resolveOptions(options);
  const maxEdge = resolved.maxEdge;
  const qualities = resolved.jpegQualities.length ? resolved.jpegQualities : [0.85, 0.72, 0.58, 0.45];

  if (dataUrl.startsWith("data:image/")) {
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
    if (!sniffImageMimeFromBase64(b64)) {
      throw new Error("That image data is not a real PNG/JPEG/GIF/WebP payload.");
    }
  }

  const image = await loadImageBitmap(dataUrl);
  const { width: naturalW, height: naturalH } = bitmapSize(image);
  if (dimensionsLookLikeBomb(naturalW, naturalH)) {
    throw new Error("That image is too large to decode safely (possible decompression bomb).");
  }
  // Canvas redraw strips EXIF GPS/metadata after orientation was applied via createImageBitmap.
  // Animated GIF/APNG: drawImage paints the first frame only (intentional).
  let fitted = fitWithinBox(naturalW, naturalH, maxEdge);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const preferPng = /\.png$/i.test(name) || dataUrl.startsWith("data:image/png");
  let mime = preferPng ? "image/png" : guessMimeFromName(name).includes("png") ? "image/png" : "image/jpeg";
  let out = "";
  let scaled = fitted.scaled;

  const paint = (width: number, height: number) => {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
  };

  paint(fitted.width, fitted.height);

  if (mime === "image/png") {
    out = canvas.toDataURL("image/png");
    if (out.length > MAX_DATA_URL_CHARS) {
      mime = "image/jpeg";
      name = name.replace(/\.png$/i, ".jpg");
    }
  }

  if (mime !== "image/png") {
    for (const quality of qualities) {
      out = canvas.toDataURL("image/jpeg", quality);
      if (out.length <= MAX_DATA_URL_CHARS) break;
    }
  }

  let edge = Math.min(fitted.width, fitted.height, maxEdge);
  while (out.length > MAX_DATA_URL_CHARS && edge > 256) {
    edge = Math.floor(edge * 0.75);
    fitted = fitWithinBox(naturalW, naturalH, edge);
    paint(fitted.width, fitted.height);
    scaled = true;
    out = canvas.toDataURL("image/jpeg", Math.min(0.7, qualities[qualities.length - 1] ?? 0.7));
    mime = "image/jpeg";
  }

  if (!out || out.length > MAX_DATA_URL_CHARS) {
    throw new Error("That image is still too large after compression. Try a smaller photo.");
  }

  if ("close" in image && typeof image.close === "function") {
    try {
      image.close();
    } catch {
      /* ignore */
    }
  }

  return {
    dataUrl: out,
    name: sanitizeMediaLabel(name) || name,
    mime,
    width: fitted.width,
    height: fitted.height,
    scaled: scaled || fitted.scaled,
  };
}
