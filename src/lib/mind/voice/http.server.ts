/**
 * Authenticated HTTP handlers for the Speak path.
 * POST /api/mind/voice/session — mint an ephemeral realtime client secret (value is not returned).
 * POST /api/mind/voice/stt — speech-to-text via xAI /v1/stt.
 * POST /api/mind/voice/tts — text-to-speech via xAI /v1/tts.
 * The voice key is read on the server only.
 */

import { decideFetchSite } from "../request-guard.ts";
import { readJsonObjectBody } from "../request-body.ts";
import { allowMindRequest } from "../limits.ts";
import { mintRealtimeClientSecret } from "./client-secret.ts";
import { resolveVoiceApiKey } from "./keys.ts";
import { speakWithFallback, transcribeWithFallback } from "./provider-fallback.ts";
import { decodeAudioBase64, validateSpeakTextInput, validateTranscribeAudioInput } from "./voice-input.ts";
import { isSpeakCode, speakFailure, voiceSecretExpired, type SpeakCode } from "./speak-failures.ts";

export type VoiceHttpDeps = {
  requireUser?: (request: Request) => Promise<string>;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  secretsPath?: string;
  now?: () => number;
  halted?: (userId: string) => Promise<boolean>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function coded(code: SpeakCode, status = 200) {
  const failure = speakFailure(code);
  return json({ ok: false, code: failure.code, error: failure.message }, status);
}

async function defaultRequireUser(request: Request): Promise<string> {
  const { requireUserId } = await import("../../auth/verify.server.ts");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

async function gate(request: Request, deps: VoiceHttpDeps): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (request.method !== "POST") return { ok: false, response: json({ ok: false, error: "Method not allowed." }, 405) };
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return { ok: false, response: json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403) };
  }
  try {
    const userId = await (deps.requireUser ?? defaultRequireUser)(request);
    return { ok: true, userId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Unauthorized") return { ok: false, response: coded("unauthenticated", 401) };
    return { ok: false, response: json({ ok: false, code: "unauthenticated", error: message }, 403) };
  }
}

async function haltOrLimit(userId: string, bucket: string, limit: number, deps: VoiceHttpDeps): Promise<Response | null> {
  const halted = deps.halted ?? (async (id: string) => {
    const { haltIsOn } = await import("../halt.server.ts");
    return haltIsOn(id);
  });
  if (await halted(userId)) return coded("emergency_stop");
  if (!allowMindRequest(bucket, userId, limit)) return coded("rate_limited");
  return null;
}

function providerOrNetwork(error: string): Response {
  if (/no speech key|not configured|no xai_api_key/i.test(error)) return coded("provider_not_configured");
  if (/did not answer|could not be reached|timed out|network/i.test(error)) return coded("network_failure");
  return json({ ok: false, code: "network_failure" as const, error: speakFailure("network_failure").message });
}

export async function handleVoiceSession(request: Request, deps: VoiceHttpDeps = {}): Promise<Response> {
  const opened = await gate(request, deps);
  if (!opened.ok) return opened.response;
  const blocked = await haltOrLimit(opened.userId, "voice_secret", 20, deps);
  if (blocked) return blocked;
  const minted = await mintRealtimeClientSecret({
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    secretsPath: deps.secretsPath,
  });
  if (!minted.ok) return providerOrNetwork(minted.error);
  if (voiceSecretExpired(minted.expiresAt, deps.now?.() ?? Date.now())) return coded("session_expired");
  return json({ ok: true, expiresAt: minted.expiresAt });
}

export async function handleVoiceStt(request: Request, deps: VoiceHttpDeps = {}): Promise<Response> {
  const opened = await gate(request, deps);
  if (!opened.ok) return opened.response;
  const blocked = await haltOrLimit(opened.userId, "speak", 8, deps);
  if (blocked) return blocked;
  const read = await readJsonObjectBody(request, 6_000_000);
  if (!read.ok) return json({ ok: false, code: "network_failure", error: read.error }, read.status);
  if (read.body.freeOnly === true) return json({ ok: false, error: "Free-only mode keeps cloud transcription off." });
  const parsed = validateTranscribeAudioInput(read.body);
  if (!parsed.ok) return json({ ok: false, code: "empty_transcript", error: parsed.error });
  const decoded = decodeAudioBase64(parsed.audioBase64);
  if (!decoded.ok) return json({ ok: false, code: "empty_transcript", error: decoded.error });
  const env = deps.env ?? process.env;
  const transcribed = await transcribeWithFallback({
    bytes: decoded.bytes,
    xaiKey: resolveVoiceApiKey(env, deps.secretsPath),
    openaiKey: env.OPENAI_API_KEY?.trim() || undefined,
    filename: parsed.filename,
    mime: parsed.mime,
    fetchImpl: deps.fetchImpl,
  });
  if (!transcribed.ok) {
    if (/no words were recognized/i.test(transcribed.error)) return coded("empty_transcript");
    return providerOrNetwork(transcribed.error);
  }
  return json({ ok: true, text: transcribed.text, provider: transcribed.provider });
}

export async function handleVoiceTts(request: Request, deps: VoiceHttpDeps = {}): Promise<Response> {
  const opened = await gate(request, deps);
  if (!opened.ok) return opened.response;
  const blocked = await haltOrLimit(opened.userId, "speak", 8, deps);
  if (blocked) return blocked;
  const read = await readJsonObjectBody(request, 32_000);
  if (!read.ok) return json({ ok: false, code: "network_failure", error: read.error }, read.status);
  if (read.body.freeOnly === true) return json({ ok: false, error: "Free-only mode keeps cloud speech off." });
  const parsed = validateSpeakTextInput(read.body.text);
  if (!parsed.ok) return json({ ok: false, code: "chat_failed", error: parsed.error });
  const env = deps.env ?? process.env;
  const voiceId = typeof read.body.voiceId === "string" ? read.body.voiceId : undefined;
  const spoken = await speakWithFallback({
    text: parsed.text,
    voiceId,
    xaiKey: resolveVoiceApiKey(env, deps.secretsPath),
    // Do not silently replace an explicitly selected xAI voice with an unrelated voice.
    // Even the implicit default is Eve. Never switch to OpenAI/alloy
    // merely because the client omitted voiceId or xAI could not respond.
    openaiKey: undefined,
    fetchImpl: deps.fetchImpl,
  });
  if (!spoken.ok) return providerOrNetwork(spoken.error);
  return json({ ok: true, audio: spoken.audio, mime: spoken.mime, provider: spoken.provider });
}

export function speakCodeFromBody(body: unknown): SpeakCode | null {
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code?: unknown }).code;
  return isSpeakCode(code) ? code : null;
}
