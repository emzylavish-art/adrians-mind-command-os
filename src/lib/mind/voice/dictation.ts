/** Browser-side mic capture helpers for composer dictation (no auto-send). */

export type DictationRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; mime: string }>;
  cancel: () => void;
  getLevel: () => number;
  stream: MediaStream | null;
};

export function preferredDictationMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

export function appendDictationText(current: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return current;
  const base = current.trimEnd();
  if (!base) return next;
  const needsSpace = !/\s$/.test(base);
  return needsSpace ? `${base} ${next}` : `${base}${next}`;
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

/**
 * Create a MediaRecorder-backed capture session with optional RMS level reads.
 * Tests can inject getUserMedia / MediaRecorder factories.
 */
export async function createDictationRecorder(options?: {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  mimeType?: string;
}): Promise<DictationRecorder> {
  const getUserMedia =
    options?.getUserMedia ??
    ((constraints: MediaStreamConstraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new Error("Microphone access is not available in this browser."));
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    });

  const stream = await getUserMedia({ audio: true, video: false });
  const mimeType = options?.mimeType || preferredDictationMime();
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    recorder = new MediaRecorder(stream);
  }

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  const data = new Uint8Array(256);

  try {
    audioCtx = new AudioContext();
    void audioCtx.resume();
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
  } catch {
    // Level meter is optional; recording still works.
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  let stopResolve: ((value: { blob: Blob; mime: string }) => void) | null = null;
  recorder.onstop = () => {
    const mime = recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    stopResolve?.({ blob, mime });
    stopResolve = null;
  };

  return {
    stream,
    start: async () => {
      chunks.length = 0;
      recorder.start(250);
    },
    stop: () =>
      new Promise((resolve, reject) => {
        if (recorder.state === "inactive") {
          resolve({ blob: new Blob([], { type: mimeType }), mime: mimeType });
          return;
        }
        stopResolve = resolve;
        try {
          recorder.stop();
        } catch (error) {
          reject(error);
        }
        for (const track of stream.getTracks()) track.stop();
        void audioCtx?.close();
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      for (const track of stream.getTracks()) track.stop();
      void audioCtx?.close();
      chunks.length = 0;
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
