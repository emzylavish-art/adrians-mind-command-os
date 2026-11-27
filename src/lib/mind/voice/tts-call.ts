/** Server-side xAI text-to-speech. The API key stays in the Authorization header and is never returned. */

import { resolveXaiVoiceId } from "./voices.ts";

export async function callXaiTts(input: {
  text: string;
  voiceId?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; audio: string; mime: "audio/mpeg" } | { ok: false; error: string; status?: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const voice_id = resolveXaiVoiceId(input.voiceId);
  let res: Response;
  try {
    res = await fetchImpl("https://api.x.ai/v1/tts", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ text: input.text, voice_id, language: "en", output_format: { codec: "mp3" } }),
    });
  } catch {
    return { ok: false, error: "Voice did not answer in time. Nothing was played." };
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Voice returned ${res.status}. Nothing was played.` };
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > 2_000_000) return { ok: false, error: "Voice returned audio that could not be played." };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 32 || bytes.length > 2_000_000) return { ok: false, error: "Voice returned audio that could not be played." };
  return { ok: true, audio: bytes.toString("base64"), mime: "audio/mpeg" };
}
