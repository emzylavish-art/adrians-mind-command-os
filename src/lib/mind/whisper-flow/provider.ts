/**
 * Server-side STT provider selection for Whisper Flow.
 * The recording destination and any alternate must be explicitly selected.
 * Configured keys describe availability, never permission to upload elsewhere.
 * Never logs key values.
 */

import { transcribeWavBytes, type SttResult } from "../voice/stt.ts";
import { resolveVoiceApiKey, XAI_VOICE_SECRETS_PATH } from "../voice/keys.ts";
import { HANDY_WHISPER_URL } from "../handy-dictation.ts";

export type SttProviderId = "handy" | "xai" | "openai";

export function parseWhisperFlowRoute(value: unknown):
  | { ok: true; provider: SttProviderId; fallbackProvider: SttProviderId | null; freeOnly: boolean }
  | { ok: false; error: string } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const isProvider = (provider: unknown): provider is SttProviderId => provider === "handy" || provider === "xai" || provider === "openai";
  if (!isProvider(input.provider)) return { ok: false, error: "Choose Handy local, xAI, or OpenAI for transcription before sending a recording." };
  const alternate = input.fallbackProvider;
  if (alternate != null && (!isProvider(alternate) || alternate === input.provider)) return { ok: false, error: "Choose a different fallback service explicitly, or leave fallback off." };
  return { ok: true, provider: input.provider, fallbackProvider: alternate == null ? null : alternate as SttProviderId, freeOnly: input.freeOnly === true };
}

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
  if (prefer === "handy") return { provider: "handy", apiKey: "" };
  if (prefer !== "xai" && prefer !== "openai") return { provider: null, error: "Choose a transcription service explicitly. Automatic provider selection is not permitted." };
  const key = prefer === "xai" ? resolveVoiceApiKey(env, secretsPath) : resolveOpenAiApiKey(env);
  if (key) return { provider: prefer, apiKey: key };
  return { provider: null, error: `${prefer === "xai" ? "xAI" : "OpenAI"} transcription is not configured. Repair that connection or explicitly choose a different service. No alternate was selected.` };
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_WHISPER_MODEL = "whisper-1";

export async function transcribeWithHandy(
  bytes: Uint8Array,
  mime?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SttResult & { provider: "handy" }> {
  if (!bytes.length) {
    return { ok: false, error: "No audio was recorded. Nothing was transcribed.", provider: "handy" };
  }
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const response = await fetchImpl(HANDY_WHISPER_URL, {
      method: "POST",
      headers: { "content-type": mime || "application/octet-stream" },
      body: new Blob([copy]),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return { ok: false, code: response.status === 401 || response.status === 403 ? "provider_rejected" : "network_failure", status: response.status, error: `Handy returned HTTP ${response.status}.`, provider: "handy" };
    const body = await response.json() as { ok?: boolean; text?: string; error?: string };
    const text = body.text?.trim() ?? "";
    if (!response.ok || !body.ok || !text) {
      return { ok: false, error: body.error || "Handy heard no words. Nothing was transcribed.", provider: "handy" };
    }
    return { ok: true, text, duration: null, provider: "handy" };
  } catch {
    return { ok: false, error: "Handy Whisper is not running on this machine. Nothing was sent to OpenAI.", provider: "handy" };
  }
}

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
  fallbackProvider?: SttProviderId | null;
  freeOnly?: boolean;
  fetchImpl?: typeof fetch;
  handyFetchImpl?: typeof fetch;
  /** Instrument cloud transport without changing the selected destination. */
  cloudFetchImpl?: typeof fetch;
  /** When omitted, resolveVoiceApiKey may still read the box secrets file via keys.ts default. */
  secretsPath?: string;
}): Promise<SttResult & { provider?: SttProviderId }> {
  const route = parseWhisperFlowRoute({ provider: input.prefer, fallbackProvider: input.fallbackProvider, freeOnly: input.freeOnly });
  if (!route.ok) return { ok: false, error: route.error };
  const secretsPath = input.secretsPath ?? XAI_VOICE_SECRETS_PATH;
  const attempt = async (provider: SttProviderId) => {
    if (provider !== "handy" && route.freeOnly) return { ok: false as const, error: "Free-only mode keeps cloud transcription off.", preflight: true };
    const selected = selectSttProvider(input.env ?? process.env, provider, secretsPath);
    if (!selected.provider) return { ok: false as const, error: selected.error, preflight: true };
    if (selected.provider === "handy") return transcribeWithHandy(input.bytes, input.mime, input.handyFetchImpl ?? input.fetchImpl);
    const result = await (selected.provider === "openai" ? transcribeWithOpenAiWhisper : transcribeWavBytes)({
      bytes: input.bytes,
      apiKey: selected.apiKey,
      mime: input.mime,
      filename: input.filename,
      fetchImpl: input.cloudFetchImpl ?? input.fetchImpl,
    });
    return { ...result, provider: selected.provider };
  };
  const first = await attempt(route.provider);
  // A missing selected credential or free-only policy must not become a retry
  // to another destination, even when an alternate was configured earlier.
  if (first.ok || "preflight" in first || !route.fallbackProvider) return first;
  return attempt(route.fallbackProvider);
}
