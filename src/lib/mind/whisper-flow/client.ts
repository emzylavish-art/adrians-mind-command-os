/** Browser client: send a recorded chunk to the Whisper Flow STT server fn. */

import { blobToBase64 } from "./capture.ts";
import { withBackoffRetry, isTransientSttError } from "./retry.ts";

export type TranscribeChunkResult =
  | { ok: true; text: string; provider?: string }
  | { ok: false; error: string };

export type TranscribeFn = (input: {
  audioBase64: string;
  mime: string;
  filename?: string;
}) => Promise<TranscribeChunkResult>;

export async function transcribeWhisperChunk(
  chunk: { blob: Blob; mime: string; sequence?: number },
  transcribe: TranscribeFn,
  options?: { signal?: AbortSignal; maxAttempts?: number },
): Promise<TranscribeChunkResult> {
  if (chunk.blob.size < 32) {
    return { ok: false, error: "No audio was recorded. Nothing was transcribed." };
  }
  const audioBase64 = await blobToBase64(chunk.blob);
  const mime = chunk.mime || "audio/webm";
  const filename = `whisper-flow-${chunk.sequence ?? 0}.${mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : "webm"}`;

  return withBackoffRetry(
    async () =>
      transcribe({
        audioBase64,
        mime,
        filename,
      }),
    {
      maxAttempts: options?.maxAttempts,
      signal: options?.signal,
      isRetryable: (result) => !result.ok && isTransientSttError(result.error),
    },
  );
}
