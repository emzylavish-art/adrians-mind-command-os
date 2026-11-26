import { allowMindRequest } from "../limits.ts";
import { authorizeExternalResource, externalResourceCall } from "../external-resource-call.server.ts";
import { withFailureEnvelope } from "../failure-envelope.ts";
/**
 * Authenticated HTTP handlers for the Speak path.
 * POST /api/mind/voice/session — mint an ephemeral realtime client secret (value is not returned).
 * POST /api/mind/voice/stt — speech-to-text via xAI /v1/stt.
 * POST /api/mind/voice/tts — text-to-speech via xAI /v1/tts.
 * The voice key is read on the server only.
 */

import { dispatchContext, reserveDispatchAttempt, runSettledDispatch, type ReserveDispatch, type SettleDispatch } from "../dispatch-attempt.ts";
import type { MonetaryDispatchContext } from "../financial-policy.ts";
import { STT_MODEL } from "./stt.ts";
import { OPENAI_STT_MODEL, OPENAI_TTS_MODEL } from "./provider-fallback.ts";
import { parseCloudSpeechPolicy } from "./route-preferences.ts";
import { decideFetchSite } from "../request-guard.ts";
import { readJsonObjectBody } from "../request-body.ts";
import { consumeSharedMindRateLimit } from "../rate-limit.server.ts";
import { mintRealtimeClientSecret } from "./client-secret.ts";
import { resolveVoiceApiKey } from "./keys.ts";
import { parseTranscriptionPolicy } from "./transcription-policy.ts";
import { resolveSelectedSpeechCredential, speakSelected, transcribeSelected } from "./provider-selection.server.ts";
import type { SelectedSpeechCredential } from "./provider-selection.ts";
import { decodeAudioBase64, validateSpeakTextInput, validateTranscribeAudioInput } from "./voice-input.ts";
import { isSpeakCode, speakFailure, voiceSecretExpired, type SpeakCode } from "./speak-failures.ts";
import { createVoiceUsageTracker, type VoiceUsageWriter } from "./usage.server.ts";

export type VoiceHttpDeps = {
  requireUser?: (request: Request) => Promise<string>;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  secretsPath?: string;
  now?: () => number;
  halted?: (userId: string) => Promise<boolean>;
  reserve?: ReserveDispatch;
  settle?: SettleDispatch;
  customCredential?: (userId: string, id: string) => Promise<SelectedSpeechCredential>;
  authorize?: (owner: string, provider: "xAI" | "OpenAI") => Promise<(ok: boolean) => Promise<void>>;
  recordUsage?: VoiceUsageWriter;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(withFailureEnvelope(body, { subsystem: "voice", status, operationKind: "generation" })), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function coded(code: SpeakCode, status = 200, dispatched?: false) {
  const failure = speakFailure(code);
  return json({ ok: false, code: failure.code, error: failure.message, ...(dispatched === false ? { dispatched: false } : {}) }, status);
}

async function defaultRequireUser(request: Request): Promise<string> {
  const { requireUserId } = await import("../../auth/verify.server.ts");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

async function gate(request: Request, deps: VoiceHttpDeps): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (request.method !== "POST") return { ok: false, response: json({ ok: false, error: "Method not allowed.", dispatched: false }, 405) };
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return { ok: false, response: json({ ok: false, error: "Forbidden: cross-site request blocked", dispatched: false }, 403) };
  }
  try {
    const userId = await (deps.requireUser ?? defaultRequireUser)(request);
    return { ok: true, userId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Unauthorized") return { ok: false, response: coded("unauthenticated", 401, false) };
    return { ok: false, response: json({ ok: false, code: "unauthenticated", error: message, dispatched: false }, 403) };
  }
}

async function haltOrLimit(userId: string, bucket: string, limit: number, deps: VoiceHttpDeps): Promise<Response | null> {
  const halted = deps.halted ?? (async (id: string) => {
    const { haltIsOn } = await import("../halt.server.ts");
    return haltIsOn(id);
  });
  if (await halted(userId)) return coded("emergency_stop", 200, false);
  if (!allowMindRequest(bucket, userId, limit)) return coded("rate_limited", 200, false);
  return null;
}

async function reserveAudio(ownerId: string, context: MonetaryDispatchContext, deps: VoiceHttpDeps) {
  const reserved = await reserveDispatchAttempt(ownerId, context, deps.reserve);
  return reserved.ok ? reserved : { ok: false as const, response: json({ ok: false, error: reserved.error, approvalId: reserved.approvalId, dispatched: false }, reserved.status) };
}

function speechContext(request: Request, body: Record<string, unknown>, selected: { provider: "xai" | "openai" }, stage: "stt" | "tts", args: unknown) {
  const provider = typeof body.provider === "string" && body.provider.startsWith("custom:") ? body.provider : selected.provider;
  // The xAI TTS contract has no model parameter. A monetary policy requires a separately priced model/session contract.
  const model = stage === "stt" ? selected.provider === "xai" ? STT_MODEL : OPENAI_STT_MODEL : selected.provider === "openai" ? OPENAI_TTS_MODEL : "";
  return dispatchContext({ operationId: request.headers.get("x-mind-operation-id") || body.operationId, taskId: body.taskId ?? body.operationId, projectId: body.projectId,
    provider, model, stage, args, textOnly: false });
}

function providerOrNetwork(error: string): Response {
  if (/no speech key|not configured|no xai_api_key/i.test(error)) return coded("provider_not_configured");
  if (/returned 401|returned 403|unauthorized|incorrect api key/i.test(error)) return json({ ok: false, code: "provider_not_configured", error: "The selected speech service rejected authorization. Repair that connection or explicitly choose another service." });
  if (/returned 429/i.test(error)) return coded("rate_limited");
  if (/did not answer|could not be reached|timed out|network/i.test(error)) return coded("network_failure");
  return json({ ok: false, code: "network_failure" as const, error: speakFailure("network_failure").message });
}

export async function handleVoiceSession(request: Request, deps: VoiceHttpDeps = {}): Promise<Response> {
  const opened = await gate(request, deps);
  if (!opened.ok) return opened.response;
  const blocked = await haltOrLimit(opened.userId, "voice_secret", 20, deps);
  if (blocked) return blocked;
  if (!resolveVoiceApiKey(deps.env ?? process.env, deps.secretsPath)) return coded("provider_not_configured", 200, false);
  const context = dispatchContext({ operationId: request.headers.get("x-mind-operation-id"), provider: "xai", model: "", stage: "realtime-session", args: { expiresAfter: 300 }, textOnly: false });
  const reserved = await reserveAudio(opened.userId, context, deps);
  if (!reserved.ok) return reserved.response;
  const minted = await runSettledDispatch(opened.userId, reserved.reservationId, () => mintRealtimeClientSecret({
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    secretsPath: deps.secretsPath,
  }), deps.settle);
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
  if (!read.ok) return json({ ok: false, code: "network_failure", error: read.error, dispatched: false }, read.status);
  if (read.body.freeOnly === true) return json({ ok: false, error: "Free-only mode keeps cloud transcription off.", dispatched: false });
  const parsed = validateTranscribeAudioInput(read.body);
  if (!parsed.ok) return json({ ok: false, code: "empty_transcript", error: parsed.error, dispatched: false });
  const decoded = decodeAudioBase64(parsed.audioBase64);
  if (!decoded.ok) return json({ ok: false, code: "empty_transcript", error: decoded.error, dispatched: false });
  const env = deps.env ?? process.env;
  const selected = await resolveSelectedSpeechCredential(opened.userId, read.body.provider, { env, secretsPath: deps.secretsPath, customCredential: deps.customCredential });
  if (!selected.ok) return json({ ok: false, code: "provider_not_configured", error: selected.error, dispatched: false });
  const context = speechContext(request, read.body, selected, "stt", { audio: parsed.audioBase64, filename: parsed.filename, mime: parsed.mime });
  const reserved = await reserveAudio(opened.userId, context, deps);
  if (!reserved.ok) return reserved.response;
  const transcribed = await runSettledDispatch(opened.userId, reserved.reservationId, () => transcribeSelected({
    selected,
    bytes: decoded.bytes,
    filename: parsed.filename,
    mime: parsed.mime,
    fetchImpl: deps.fetchImpl,
  }), deps.settle);
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
  if (!read.ok) return json({ ok: false, code: "network_failure", error: read.error, dispatched: false }, read.status);
  if (read.body.freeOnly === true) return json({ ok: false, error: "Free-only mode keeps cloud speech off.", dispatched: false });
  const parsed = validateSpeakTextInput(read.body.text);
  if (!parsed.ok) return json({ ok: false, code: "chat_failed", error: parsed.error, dispatched: false });
  const env = deps.env ?? process.env;
  const voiceId = typeof read.body.voiceId === "string" ? read.body.voiceId : undefined;
  const selected = await resolveSelectedSpeechCredential(opened.userId, read.body.provider, { env, secretsPath: deps.secretsPath, customCredential: deps.customCredential });
  if (!selected.ok) return json({ ok: false, code: "provider_not_configured", error: selected.error, dispatched: false });
  const context = speechContext(request, read.body, selected, "tts", { text: parsed.text, voiceId });
  const reserved = await reserveAudio(opened.userId, context, deps);
  if (!reserved.ok) return reserved.response;
  const spoken = await runSettledDispatch(opened.userId, reserved.reservationId, () => speakSelected({
    selected, text: parsed.text, voiceId,
    fetchImpl: deps.fetchImpl,
  }), deps.settle);
  if (!spoken.ok) return providerOrNetwork(spoken.error);
  return json({ ok: true, audio: spoken.audio, mime: spoken.mime, provider: spoken.provider });
}

export function speakCodeFromBody(body: unknown): SpeakCode | null {
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code?: unknown }).code;
  return isSpeakCode(code) ? code : null;
}
