/**
 * Server-side STT provider selection for Whisper Flow.
 * Prefers xAI STT (existing). Optional OpenAI Whisper when OPENAI_API_KEY is set
 * and provider preference is "openai" or xAI key is missing.
 * Never logs key values.
 */

import { transcribeWavBytes, type SttResult } from "../voice/stt.ts";
import { resolveVoiceApiKey, XAI_VOICE_SECRETS_PATH } from "../voice/keys.ts";

export type SttProviderId = "xai" | "openai";

export function resolveOpenAiApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.OPENAI_API_KEY?.trim() || undefined;
}

export function selectSttProvider(
  env: Record<string, string | undefined> = process.env,
  prefer?: SttProviderId | "auto",
  secretsPath: string = XAI_VOICE_SECRETS_PATH,
): { provider: SttProviderId; apiKey: string } | { provider: null; error: string } {
  const xai = resolveVoiceApiKey(env, secretsPath);
  const openai = resolveOpenAiApiKey(env);
  const preference = prefer ?? "auto";

  if (preference === "openai") {
    if (openai) return { provider: "openai", apiKey: openai };
    if (xai) return { provider: "xai", apiKey: xai };
  } else if (preference === "xai") {
    if (xai) return { provider: "xai", apiKey: xai };
    if (openai) return { provider: "openai", apiKey: openai };
  } else {
    if (xai) return { provider: "xai", apiKey: xai };
    if (openai) return { provider: "openai", apiKey: openai };
  }
  return {
    provider: null,
    error:
      "No speech-to-text key is configured on the server. Whisper Flow cannot transcribe. Nothing was invented.",
  };
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_WHISPER_MODEL = "whisper-1";

export async function transcribeWithOpenAiWhisper(input: {
  bytes: Uint8Array;
  apiKey: string;
  filename?: string;
  mime?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SttResult> {
  if (!input.apiKey) {
    return { ok: false, error: "No speech key is configured. Nothing was transcribed." };
  }
  if (!input.bytes.length) {
    return { ok: false, error: "No audio was recorded. Nothing was transcribed." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  const mime = input.mime || "audio/webm";
  const filename = input.filename || "dictation.webm";
  const copy = new Uint8Array(input.bytes);
  form.append("file", new Blob([copy], { type: mime }), filename);
  form.append("model", OPENAI_WHISPER_MODEL);
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_WHISPER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    });
  } catch {
    return { ok: false, error: "Speech-to-text did not answer in time. Nothing was transcribed." };
  }
  if (!response.ok) {
    return { ok: false, error: `Speech-to-text returned ${response.status}. Nothing was transcribed.` };
  }
  let payload: { text?: string };
  try {
    payload = (await response.json()) as { text?: string };
  } catch {
    return { ok: false, error: "Speech-to-text returned a response that could not be read." };
  }
  const text = (payload.text || "").trim();
  if (!text) return { ok: false, error: "No words were recognized. Nothing was inserted." };
  return { ok: true, text, duration: null };
}

export async function transcribeWhisperFlowAudio(input: {
  bytes: Uint8Array;
  mime?: string;
  filename?: string;
  env?: Record<string, string | undefined>;
  prefer?: SttProviderId | "auto";
  fetchImpl?: typeof fetch;
  /** When omitted, resolveVoiceApiKey may still read the box secrets file via keys.ts default. */
  secretsPath?: string;
}): Promise<SttResult & { provider?: SttProviderId }> {
  const secretsPath = input.secretsPath ?? XAI_VOICE_SECRETS_PATH;
  const selected = selectSttProvider(input.env ?? process.env, input.prefer, secretsPath);
  if (!selected.provider) return { ok: false, error: selected.error };
  if (selected.provider === "openai") {
    const result = await transcribeWithOpenAiWhisper({
      bytes: input.bytes,
      apiKey: selected.apiKey,
      mime: input.mime,
      filename: input.filename,
      fetchImpl: input.fetchImpl,
    });
    return { ...result, provider: "openai" };
  }
  const result = await transcribeWavBytes({
    bytes: input.bytes,
    apiKey: selected.apiKey,
    mime: input.mime,
    filename: input.filename,
    fetchImpl: input.fetchImpl,
  });
  return { ...result, provider: "xai" };
}
