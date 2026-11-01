import { fitWithinBox, guessMimeFromName, MAX_IMAGE_EDGE } from "@/lib/mind/media";

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
  const fitted = fitWithinBox(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(image, 0, 0, fitted.width, fitted.height);
  const preferPng = /\.png$/i.test(name) || dataUrl.startsWith("data:image/png");
  const mime = preferPng ? "image/png" : guessMimeFromName(name).includes("png") ? "image/png" : "image/jpeg";
  const out = mime === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  return {
    dataUrl: out,
    name,
    mime,
    width: fitted.width,
    height: fitted.height,
    scaled: fitted.scaled,
  };
}
