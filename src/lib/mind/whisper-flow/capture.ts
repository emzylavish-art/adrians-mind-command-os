/** MediaRecorder capture with timeslice chunks for Whisper Flow. */

import { WHISPER_FLOW_CHUNK_MS } from "./types.ts";
import { mapWhisperMicError, whisperFlowSupported } from "./errors.ts";

export type WhisperChunk = { blob: Blob; mime: string; sequence: number };

export type WhisperCapture = {
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<WhisperChunk | null>;
  cancel: () => void;
  getLevel: () => number;
  stream: MediaStream | null;
  mime: string;
};

export function preferredWhisperMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

export async function createWhisperCapture(options?: {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  mimeType?: string;
  chunkMs?: number;
  onChunk?: (chunk: WhisperChunk) => void;
  onTrackEnded?: () => void;
}): Promise<WhisperCapture> {
  const support = whisperFlowSupported();
  if (!support.ok) throw new Error(support.error);

  const getUserMedia =
    options?.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));

  let stream: MediaStream;
  try {
    stream = await getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    throw new Error(mapWhisperMicError(err));
  }

  const mimeType = options?.mimeType || preferredWhisperMime();
  const chunkMs = options?.chunkMs ?? WHISPER_FLOW_CHUNK_MS;
  const pendingParts: BlobPart[] = [];
  let sequence = 0;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    recorder = new MediaRecorder(stream);
  }

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  const data = new Uint8Array(256);
  try {
    audioCtx = new AudioContext();
    void audioCtx.resume();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
  } catch {
    /* level optional */
  }

  const flushChunk = (final: boolean): WhisperChunk | null => {
    if (!pendingParts.length) return null;
    const mime = recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(pendingParts.splice(0, pendingParts.length), { type: mime });
    if (blob.size < 32 && !final) return null;
    if (blob.size < 32) return null;
    sequence += 1;
    const chunk = { blob, mime, sequence };
    options?.onChunk?.(chunk);
    return chunk;
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) pendingParts.push(event.data);
    if (recorder.state === "recording") flushChunk(false);
  };

  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => options?.onTrackEnded?.());
  }

  let stopResolve: ((value: WhisperChunk | null) => void) | null = null;
  recorder.onstop = () => {
    const last = flushChunk(true);
    stopResolve?.(last);
    stopResolve = null;
  };

  const cleanup = () => {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    void audioCtx?.close();
  };

  return {
    stream,
    mime: mimeType,
    start: async () => {
      pendingParts.length = 0;
      sequence = 0;
      recorder.start(chunkMs);
    },
    pause: () => {
      if (recorder.state === "recording") recorder.pause();
    },
    resume: () => {
      if (recorder.state === "paused") recorder.resume();
    },
    stop: () =>
      new Promise((resolve, reject) => {
        if (recorder.state === "inactive") {
          resolve(flushChunk(true));
          cleanup();
          return;
        }
        stopResolve = (chunk) => {
          cleanup();
          resolve(chunk);
        };
        try {
          recorder.stop();
        } catch (error) {
          cleanup();
          reject(error);
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      pendingParts.length = 0;
      cleanup();
    },
    getLevel: () => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 4);
    },
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
