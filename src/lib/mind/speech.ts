import { resolveXaiVoiceId } from "./voice/voices.ts";

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; bytes: () => Promise<Uint8Array> }>;

export async function synthesizeSpeech(input: {
  text: string;
  voiceKey: string | undefined;
  fetch: FetchLike;
  voiceId?: string;
}): Promise<{ ok: boolean; audio: string; error: string }> {
  const text = input.text.trim().slice(0, 500);
  if (!text) return { ok: false, audio: "", error: "Nothing to read." };
  if (!input.voiceKey) return { ok: false, audio: "", error: "The chat key is not used for speech. No speech key is configured. Nothing was played." };
  const voice_id = resolveXaiVoiceId(input.voiceId);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await input.fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${input.voiceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ text, voice_id, language: "en", output_format: { codec: "mp3" } }),
    });
  } catch {
    return { ok: false, audio: "", error: "Voice did not answer in time. Nothing was played." };
  }
  if (!response.ok) return { ok: false, audio: "", error: `Voice returned ${response.status}. Nothing was played.` };
  const bytes = await response.bytes();
  if (bytes.length < 32) return { ok: false, audio: "", error: "Voice returned audio that could not be played." };
  return { ok: true, audio: "audio", error: "" };
}
