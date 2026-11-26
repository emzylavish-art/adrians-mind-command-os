import { reportedModel } from "../stream.ts";
/**
 * Server-side voice and Direct-chat fallback.
 * Tries xAI first. OpenAI is used only on this server, from OPENAI_API_KEY.
 * Keys are never copied into the result.
 */

import { transcribeWavBytes } from "./stt.ts";
import { callXaiTts } from "./tts-call.ts";

export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_TTS_VOICE = "alloy";
export const OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";
export const OPENAI_CHAT_MODEL = "gpt-4o-mini";

export type AnswerProvider = "xAI" | "OpenAI";

export type FallbackOk<T> = { ok: true; provider: AnswerProvider } & T;
export type FallbackFail = { ok: false; error: string; provider: null };

export function isXaiAuthFailure(status: number, body = ""): boolean {
  if (status === 401) return true;
  if (status !== 400) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication")
  );
}

function honestBoth(action: string): string {
  const result = action === "transcribed" ? "transcription" : action === "played" ? "playable audio" : "successful reply";
  return `xAI and OpenAI did not produce a successful ${result}.`;
}

async function openAiSpeech(input: {
  text: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; audio: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await input.fetchImpl(OPENAI_TTS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: input.text }),
    });
  } catch {
    return { ok: false, error: "OpenAI speech did not answer." };
  }
  if (!res.ok) return { ok: false, error: `OpenAI speech returned ${res.status}.` };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 32 || bytes.length > 2_000_000) return { ok: false, error: "OpenAI speech returned audio that could not be played." };
  return { ok: true, audio: bytes.toString("base64") };
}

async function openAiTranscribe(input: {
  bytes: Uint8Array;
  apiKey: string;
  filename?: string;
  mime?: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const form = new FormData();
  const copy = new Uint8Array(input.bytes);
  form.append("file", new Blob([copy], { type: input.mime || "audio/webm" }), input.filename || "speak.webm");
  form.append("model", OPENAI_STT_MODEL);
  let res: Response;
  try {
    res = await input.fetchImpl(OPENAI_STT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${input.apiKey}` },
      body: form,
    });
  } catch {
    return { ok: false, error: "OpenAI transcription did not answer." };
  }
  if (!res.ok) return { ok: false, error: `OpenAI transcription returned ${res.status}.` };
  let payload: { text?: string };
  try {
    payload = (await res.json()) as { text?: string };
  } catch {
    return { ok: false, error: "OpenAI transcription returned a response that could not be read." };
  }
  const text = (payload.text || "").trim();
  if (!text) return { ok: false, error: "OpenAI transcription returned no words." };
  return { ok: true, text };
}

export async function openAiDirectChat(input: {
  messages: { role: string; content: string }[];
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
  if (!input.apiKey) return { ok: false, error: "OpenAI is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: OPENAI_CHAT_MODEL, messages: input.messages }),
    });
  } catch {
    return { ok: false, error: "OpenAI chat did not answer." };
  }
  if (!res.ok) return { ok: false, error: `OpenAI chat returned ${res.status}.` };
  let payload: { model?: unknown; choices?: { message?: { content?: string } }[] };
  try {
    payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  } catch {
    return { ok: false, error: "OpenAI chat returned a response that could not be read." };
  }
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return { ok: false, error: "OpenAI chat returned an empty reply." };
  return { ok: true, text, model: reportedModel(payload.model) };
}

export async function transcribeWithFallback(input: {
  bytes: Uint8Array;
  /** Explicit transcription choice. A configured key does not authorize a fallback. */
  provider?: "xai" | "openai";
  xaiKey?: string;
  openaiKey?: string;
  filename?: string;
  mime?: string;
  fetchImpl?: typeof fetch;
}): Promise<FallbackOk<{ text: string }> | FallbackFail> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const provider = input.provider ?? "xai";
  if (provider === "openai") {
    if (!input.openaiKey) return { ok: false, error: "OpenAI transcription is not configured. No audio was sent.", provider: null };
    const result = await openAiTranscribe({
      bytes: input.bytes, apiKey: input.openaiKey, filename: input.filename, mime: input.mime, fetchImpl,
    });
    return result.ok
      ? { ok: true, text: result.text, provider: "OpenAI" }
      : { ok: false, error: result.error, provider: null };
  }
  if (!input.xaiKey) return { ok: false, error: "xAI transcription is not configured. No audio was sent.", provider: null };
  const result = await transcribeWavBytes({
    bytes: input.bytes, apiKey: input.xaiKey, filename: input.filename, mime: input.mime, fetchImpl,
  });
  return result.ok
    ? { ok: true, text: result.text, provider: "xAI" }
    : { ok: false, error: result.error, provider: null };
}

export async function speakWithFallback(input: {
  text: string;
  voiceId?: string;
  xaiKey?: string;
  openaiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<FallbackOk<{ audio: string; mime: "audio/mpeg" }> | FallbackFail> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let selectedVoiceError = "xAI voice is not configured. Nothing was played or substituted.";
  if (input.xaiKey) {
    const first = await callXaiTts({ text: input.text, voiceId: input.voiceId, apiKey: input.xaiKey, fetchImpl });
    if (first.ok) return { ok: true, audio: first.audio, mime: "audio/mpeg", provider: "xAI" };
    selectedVoiceError = first.error;
  }
  // Explicit opt-in callers may supply an OpenAI key to enable an alternative
  // voice. Normal Speak routes do not; failures preserve the chosen voice.
  if (!input.openaiKey) return { ok: false, error: selectedVoiceError, provider: null };
  const second = await openAiSpeech({ text: input.text, apiKey: input.openaiKey, fetchImpl });
  if (!second.ok) return { ok: false, error: honestBoth("played"), provider: null };
  return { ok: true, audio: second.audio, mime: "audio/mpeg", provider: "OpenAI" };
}

export async function directChatWithFallback(input: {
  messages: { role: string; content: string }[];
  xaiKey?: string;
  openaiKey?: string;
  fetchImpl?: typeof fetch;
  xaiModel?: string;
}): Promise<FallbackOk<{ text: string; model: string }> | FallbackFail> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.xaiModel || "grok-4.5";
  if (input.xaiKey) {
    let res: Response;
    try {
      res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${input.xaiKey}` },
        body: JSON.stringify({ model, messages: input.messages }),
      });
    } catch {
      return { ok: false, error: "xAI chat did not answer. Nothing was substituted.", provider: null };
    }
    if (res.ok) {
      let payload: { model?: unknown; choices?: { message?: { content?: string } }[] };
      try {
        payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      } catch {
        return { ok: false, error: "xAI chat returned a response that could not be read.", provider: null };
      }
      const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) return { ok: false, error: "xAI chat returned an empty reply.", provider: null };
      return { ok: true, text, model: reportedModel(payload.model), provider: "xAI" };
    }
    const body = await res.text().catch(() => "");
    if (!isXaiAuthFailure(res.status, body)) {
      return { ok: false, error: `xAI chat returned ${res.status}. Nothing was substituted.`, provider: null };
    }
  }
  const second = await openAiDirectChat({ messages: input.messages, apiKey: input.openaiKey ?? "", fetchImpl });
  if (!second.ok) return { ok: false, error: honestBoth("sent"), provider: null };
  return { ok: true, text: second.text, model: second.model, provider: "OpenAI" };
}
