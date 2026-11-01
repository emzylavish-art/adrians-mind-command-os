/**
 * Attachment validation + frame throttling for live-voice bar.
 * Image input is NOT natively supported by xAI grok-voice realtime (accepted but ignored);
 * callers must use chat/vision fallback.
 */

export const MAX_ATTACH_BYTES = 4_000_000;
export const MAX_TEXT_FILE_CHARS = 4_000;
export const MAX_VIDEO_FRAMES = 8;
export const VIDEO_SAMPLE_FPS = 1;
export const SCREEN_FRAME_INTERVAL_MS = 2_000;

export const TEXT_FILE_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".log",
]);

export type AttachKind = "camera" | "photo" | "video" | "files";

export type AttachValidation =
  | { ok: true; kind: "image" | "video" | "text"; mime: string; name: string; size: number }
  | { ok: false; error: string };

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function validateAttachment(file: { name: string; type: string; size: number }, expect: AttachKind): AttachValidation {
  if (!file || file.size <= 0) return { ok: false, error: "That file was empty." };
  if (file.size > MAX_ATTACH_BYTES) {
    return { ok: false, error: `That file is too large (${Math.round(file.size / 1024)} KB). Max is ${Math.round(MAX_ATTACH_BYTES / 1024)} KB.` };
  }
  const mime = (file.type || "").toLowerCase();
  const ext = extOf(file.name || "file");

  if (expect === "photo" || expect === "camera") {
    if (!mime.startsWith("image/") && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) {
      return { ok: false, error: "Only image files can be attached as a photo." };
    }
    return { ok: true, kind: "image", mime: mime || "image/jpeg", name: file.name || "photo.jpg", size: file.size };
  }
  if (expect === "video") {
    if (!mime.startsWith("video/") && !/\.(mp4|webm|mov|mkv)$/i.test(ext)) {
      return { ok: false, error: "Only video files can be attached here." };
    }
    return { ok: true, kind: "video", mime: mime || "video/mp4", name: file.name || "video.mp4", size: file.size };
  }
  // files
  if (TEXT_FILE_EXTS.has(ext) || mime.startsWith("text/") || mime === "application/json") {
    return { ok: true, kind: "text", mime: mime || "text/plain", name: file.name || "file.txt", size: file.size };
  }
  return {
    ok: false,
    error: "That file type is not supported in live voice. Use text-like files (txt, md, csv, json, code).",
  };
}

/** One-in-flight frame gate: drop extras while a send is pending. */
export type FrameGate = { inflight: boolean; dropped: number };

export function createFrameGate(): FrameGate {
  return { inflight: false, dropped: 0 };
}

export function beginFrame(gate: FrameGate): boolean {
  if (gate.inflight) {
    gate.dropped += 1;
    return false;
  }
  gate.inflight = true;
  return true;
}

export function endFrame(gate: FrameGate): void {
  gate.inflight = false;
}

export function revokeUrl(url: string | null | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

/** Whether xAI realtime natively understands input_image (documented: no — ignored). */
export const REALTIME_NATIVE_INPUT_IMAGE = false;
