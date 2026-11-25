/** One bounded microphone take for Speak. Tests inject getUserMedia and MediaRecorder. No provider calls. */

import { blobToBase64, preferredDictationMime } from "./dictation.ts";
import { speakCanceled, speakFailure, type SpeakCanceled, type SpeakFailure } from "./speak-failures.ts";

export type CaptureOk = { ok: true; audioBase64: string; mime: string };
export type CaptureResult = CaptureOk | SpeakFailure | SpeakCanceled;

type RecorderLike = {
  state: string;
  mimeType?: string;
  start: (timeslice?: number) => void;
  stop: () => void;
  ondataavailable: ((event: { data?: Blob }) => void) | null;
  onstop: (() => void) | null;
};

export async function captureSpeakUtterance(options?: {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: new (stream: MediaStream, init?: MediaRecorderOptions) => MediaRecorder;
  signal?: AbortSignal;
  maxMs?: number;
  mimeType?: string;
}): Promise<CaptureResult> {
  if (options?.signal?.aborted) return speakCanceled();
  const getUserMedia =
    options?.getUserMedia ??
    ((constraints: MediaStreamConstraints) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(Object.assign(new Error("No microphone was found."), { name: "NotFoundError" }));
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    });
  let stream: MediaStream;
  try {
    stream = await getUserMedia({ audio: true, video: false });
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String((error as { name?: string }).name) : "";
    if (name === "NotAllowedError" || name === "SecurityError") return speakFailure("mic_denied");
    return speakFailure("mic_missing");
  }
  if (options?.signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    return speakCanceled();
  }
  const Recorder = options?.MediaRecorder ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  if (!Recorder) {
    stream.getTracks().forEach((track) => track.stop());
    return speakFailure("mic_missing");
  }
  const mimeType = options?.mimeType || preferredDictationMime();
  let recorder: RecorderLike;
  try {
    recorder = new Recorder(stream, { mimeType }) as unknown as RecorderLike;
  } catch {
    try {
      recorder = new Recorder(stream) as unknown as RecorderLike;
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      return speakFailure("mic_missing");
    }
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  const maxMs = options?.maxMs ?? 6000;
  const timer = setTimeout(() => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped */
    }
  }, maxMs);
  const onAbort = () => {
    clearTimeout(timer);
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped */
    }
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    recorder.start(200);
  } catch {
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    return speakFailure("mic_missing");
  }
  await stopped;
  clearTimeout(timer);
  options?.signal?.removeEventListener("abort", onAbort);
  stream.getTracks().forEach((track) => track.stop());
  if (options?.signal?.aborted) return speakCanceled();
  const mime = recorder.mimeType || chunks[0]?.type || mimeType;
  const blob = new Blob(chunks, { type: mime });
  if (blob.size < 32) return speakFailure("empty_transcript");
  const audioBase64 = await blobToBase64(blob);
  if (!audioBase64) return speakFailure("empty_transcript");
  return { ok: true, audioBase64, mime };
}
