/** Server-side xAI speech-to-text (POST /v1/stt). Never log the API key. */

import { audioMimeBase, isAllowedAudioMime, sanitizeAudioFilename } from "./voice-input.ts";

export const STT_URL = "https://api.x.ai/v1/stt";
export const STT_MODEL = "grok-voice-transcribe-2.0";

export type SttResult =
  | { ok: true; text: string; duration: number | null }
  | { ok: false; error: string; code?: "provider_not_configured" | "empty_transcript" | "provider_rejected" | "rate_limited" | "network_failure"; status?: number };

export async function transcribeWavBytes(input: {
  bytes: Uint8Array;
  apiKey: string;
  filename?: string;
  mime?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SttResult> {
  if (!input.apiKey) return { ok: false, code: "provider_not_configured", error: "No speech key is configured. Nothing was transcribed." };
  if (!input.bytes.length) return { ok: false, code: "empty_transcript", error: "No audio was recorded. Nothing was transcribed." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  const rawMime = input.mime || "audio/wav";
  const mime = isAllowedAudioMime(rawMime) ? audioMimeBase(rawMime) : "audio/wav";
  const filename = sanitizeAudioFilename(input.filename, mime);
  // Uint8Array → ArrayBuffer copy so BlobPart typing is happy across runtimes.
  const copy = new Uint8Array(input.bytes);
  form.append("file", new Blob([copy], { type: mime }), filename);
  form.append("model", STT_MODEL);
  let response: Response;
  try {
    response = await fetchImpl(STT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    });
  } catch {
    return { ok: false, code: "network_failure", error: "Speech-to-text did not answer in time. Nothing was transcribed." };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, code: response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "provider_rejected" : "network_failure", error: `Speech-to-text returned ${response.status}. Nothing was transcribed.` };
  }
  let payload: { text?: string; duration?: number };
  try {
    payload = (await response.json()) as { text?: string; duration?: number };
  } catch {
    return { ok: false, code: "network_failure", error: "Speech-to-text returned a response that could not be read." };
  }
  const text = (payload.text || "").trim();
  if (!text) return { ok: false, code: "empty_transcript", error: "No words were recognized. Nothing was inserted." };
  return { ok: true, text, duration: typeof payload.duration === "number" ? payload.duration : null };
}
