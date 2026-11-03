/**
 * Camera / screen frame capture for live-voice bar.
 * One frame in flight at a time; stop tracks on toggle-off.
 */
import {
  beginFrame,
  createFrameGate,
  endFrame,
  SCREEN_FRAME_INTERVAL_MS,
  type FrameGate,
} from "@/lib/mind/voice-live/attachments";

export type FrameSink = (jpegBase64: string) => Promise<void> | void;

export type FrameStreamHandle = {
  stop: () => void;
  active: () => boolean;
  gate: FrameGate;
};

function canvasJpeg(video: HTMLVideoElement, quality = 0.7): string | null {
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  const max = 1280;
  const scale = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : null;
}

export async function startMediaFrameStream(
  stream: MediaStream,
  onFrame: FrameSink,
  intervalMs = SCREEN_FRAME_INTERVAL_MS,
): Promise<FrameStreamHandle> {
  const gate = createFrameGate();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped) return;
    if (!beginFrame(gate)) return;
    try {
      const b64 = canvasJpeg(video);
      if (b64) await onFrame(b64);
    } finally {
      endFrame(gate);
    }
  };

  timer = setInterval(() => {
    void tick();
  }, Math.max(500, intervalMs));
  void tick();

  return {
    gate,
    active: () => !stopped,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Snapshot one JPEG from getUserMedia camera (attach menu Camera). */
export async function captureCameraJpeg(): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "Camera is not available in this browser." };
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const b64 = canvasJpeg(video, 0.85);
    video.srcObject = null;
    if (!b64) return { ok: false, error: "Could not capture a camera frame." };
    return { ok: true, base64: b64 };
  } catch (caught) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, error: "Camera permission was denied." };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, error: "No camera was found." };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return { ok: false, error: "Camera is busy or already in use." };
    }
    if (name === "AbortError" || name === "NotSupportedError") {
      return { ok: false, error: "Camera capture was cancelled." };
    }
    return { ok: false, error: "Camera capture failed." };
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export async function openCameraStream(): Promise<{ ok: true; stream: MediaStream } | { ok: false; error: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "Camera is not available in this browser." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    return { ok: true, stream };
  } catch (caught) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, error: "Camera permission was denied." };
    }
    if (name === "NotFoundError") return { ok: false, error: "No camera was found." };
    if (name === "NotReadableError" || name === "TrackStartError") {
      return { ok: false, error: "Camera is busy or already in use." };
    }
    if (name === "AbortError") return { ok: false, error: "Camera was cancelled." };
    return { ok: false, error: "Could not open the camera." };
  }
}

export async function openScreenStream(): Promise<{ ok: true; stream: MediaStream } | { ok: false; error: string }> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return { ok: false, error: "Screen share was cancelled or isn't available." };
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return { ok: true, stream };
  } catch (caught) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      return { ok: false, error: "Screen share was cancelled or isn't available." };
    }
    return { ok: false, error: "Screen share was cancelled or isn't available." };
  }
}

/** Sample up to maxFrames from a video File at ~1 fps. */
export async function sampleVideoFrames(
  file: File,
  maxFrames: number,
): Promise<{ ok: true; frames: string[] } | { ok: false; error: string }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("bad video"));
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration)));
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(duration - 0.05, (i + 0.5) * (duration / count));
      video.currentTime = Math.max(0, t);
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          resolve();
        };
        video.addEventListener("seeked", done);
      });
      const b64 = canvasJpeg(video, 0.7);
      if (b64) frames.push(b64);
    }
    if (!frames.length) return { ok: false, error: "Could not sample frames from that video." };
    return { ok: true, frames };
  } catch {
    return { ok: false, error: "Could not read that video file." };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function readTextFile(file: File, maxChars: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.slice(0, maxChars));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsText(file);
  });
}
