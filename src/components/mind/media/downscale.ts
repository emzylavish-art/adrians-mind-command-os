import { fitWithinBox, guessMimeFromName, MAX_DATA_URL_CHARS, MAX_IMAGE_EDGE } from "@/lib/mind/media";

export type DownscaleResult = {
  dataUrl: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  scaled: boolean;
};

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

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = dataUrl;
  });
}

/** Downscale a File or data-URL to max edge (default 2048) as JPEG/PNG data-URL. */
export async function fileToDownscaledDataUrl(
  file: File,
  maxEdge = MAX_IMAGE_EDGE,
): Promise<DownscaleResult> {
  const source = await readFileAsDataUrl(file);
  return dataUrlToDownscaled(source, file.name || "image.jpg", maxEdge);
}

export async function dataUrlToDownscaled(
  dataUrl: string,
  name = "image.jpg",
  maxEdge = MAX_IMAGE_EDGE,
): Promise<DownscaleResult> {
  const image = await loadImage(dataUrl);
  let fitted = fitWithinBox(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const preferPng = /\.png$/i.test(name) || dataUrl.startsWith("data:image/png");
  let mime = preferPng ? "image/png" : guessMimeFromName(name).includes("png") ? "image/png" : "image/jpeg";
  let out = "";
  let scaled = fitted.scaled;
  const qualities = [0.85, 0.72, 0.58, 0.45];

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
      // Fall back to JPEG for oversized PNGs.
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

  // Still too big — shrink the edge further.
  let edge = Math.min(fitted.width, fitted.height, maxEdge);
  while (out.length > MAX_DATA_URL_CHARS && edge > 256) {
    edge = Math.floor(edge * 0.75);
    fitted = fitWithinBox(image.naturalWidth || image.width, image.naturalHeight || image.height, edge);
    paint(fitted.width, fitted.height);
    scaled = true;
    out = canvas.toDataURL("image/jpeg", 0.7);
    mime = "image/jpeg";
  }

  if (!out || out.length > MAX_DATA_URL_CHARS) {
    throw new Error("That image is still too large after compression. Try a smaller photo.");
  }

  return {
    dataUrl: out,
    name,
    mime,
    width: fitted.width,
    height: fitted.height,
    scaled: scaled || fitted.scaled,
  };
}
