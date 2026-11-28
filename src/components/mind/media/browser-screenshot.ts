import { safeBrowserScreenshot } from "@/lib/mind/browser-activity";

export function screenshotJpeg(source: CanvasImageSource, width: number, height: number) {
  if (width < 1 || height < 1) throw new Error("The selected source did not supply an image.");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Screenshot preparation is unavailable.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.9, 0.76, 0.6, 0.42]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (safeBrowserScreenshot(data)) return data;
  }
  throw new Error("The screenshot is too large. Crop it and try again.");
}

export async function readScreenshotFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 16 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPEG or WebP screenshot up to 16 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return screenshotJpeg(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function captureBrowserTab(signal: AbortSignal) {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Tab capture is unavailable. Upload a screenshot instead.");
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false });
  const video = document.createElement("video");
  const stop = () => stream.getTracks().forEach(track => track.stop());
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") throw new Error("Select a browser tab to capture one frame.");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    signal.throwIfAborted();
    return screenshotJpeg(video, video.videoWidth, video.videoHeight);
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
    video.pause();
    video.srcObject = null;
  }
}

export function screenshotFile(dataUrl: string, name: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), char => char.charCodeAt(0));
  return new File([bytes], name.replace(/\.[a-z0-9]{1,8}$/i, "") + ".jpg", { type: "image/jpeg" });
}
