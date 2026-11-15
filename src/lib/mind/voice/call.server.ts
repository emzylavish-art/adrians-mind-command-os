import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { requireUserId } from "../../auth/verify.server.ts";
import { assertSameOrigin } from "../connectors/oauth-csrf.ts";
import { resolveXaiInferenceApiKey } from "../media/xai-key.ts";
import { resolveVoiceApiKey } from "./keys.ts";
import { recordReceipt } from "../receipts.server.ts";
import { directChatWithFallback, speakWithFallback, transcribeWithFallback } from "./provider-fallback.ts";

const run = promisify(execFile);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function wavFromMpeg(bytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "adrian-call-"));
  try {
    const input = join(dir, "caller.mp3");
    const output = join(dir, "caller.wav");
    await writeFile(input, bytes);
    await run("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", output], { timeout: 20_000 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function handleVoiceCall(request: Request): Promise<Response> {
  let userId = "";
  try {
    userId = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined);
  } catch {
    return json({ ok: false, error: "Sign in is required. Nothing was spoken." }, 401);
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = assertSameOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  const key = resolveVoiceApiKey();
  if (!key) return json({ ok: false, error: "No voice key is configured. Nothing was spoken." }, 400);
  const caller = await speakWithFallback({ text: "Say only the word cedarline.", voiceId: "eve", xaiKey: key });
  if (!caller.ok) return json({ ok: false, error: caller.error }, 502);
  let audio = Buffer.from(caller.audio, "base64");
  let mime = "audio/mpeg";
  let filename = "caller.mp3";
  try {
    audio = await wavFromMpeg(audio);
    mime = "audio/wav";
    filename = "caller.wav";
  } catch {
    // The speech file can still be transcribed as mpeg when conversion is unavailable.
  }
  const heard = await transcribeWithFallback({ bytes: audio, xaiKey: key, filename, mime });
  if (!heard.ok) return json({ ok: false, error: heard.error }, 502);
  const chatKey = resolveXaiInferenceApiKey() || key;
  const chat = await directChatWithFallback({
    xaiKey: chatKey,
    xaiModel: "grok-4.20-0309-non-reasoning",
    messages: [
      { role: "system", content: "Reply with only the single word the caller asked you to say. No punctuation." },
      { role: "user", content: heard.text },
    ],
  });
  if (!chat.ok) return json({ ok: false, error: chat.error, heard: heard.text }, 502);
  const reply = chat.text.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || chat.text.slice(0, 40);
  const spoken = await speakWithFallback({ text: reply, voiceId: "eve", xaiKey: key });
  if (!spoken.ok) return json({ ok: false, error: spoken.error, heard: heard.text, reply }, 502);
  await recordReceipt(userId, { state: "EXECUTED", action: "speak-call", detail: `Heard and spoke a reply. Provider ${spoken.provider}.` });
  return json({ ok: true, heard: heard.text, reply, audio: spoken.audio, mime: spoken.mime, provider: spoken.provider });
}
