/**
 * Speak failure classification and retry for Error Banners.
 * No banner UI. Kinds are the existing HonestFailureKind set — microphone
 * permission, a missing microphone, and blocked playback have no kind of their
 * own (see docs/voice/ERROR_CONTRACT.md). Those three use `network_failure`
 * only as the bucket; the message stays the voice copy.
 *
 * Failure is read from `ok === false`, `transport.ok === false`, or
 * `rpc.isError === true` (and thrown errors). A numeric HTTP status is ignored.
 * Retry does not send a chat turn that already committed.
 */
import { CHAT_TIMEOUT_REPLY, HONEST_FAILURE_MESSAGES, type HonestFailureKind } from "../failure-states.ts";
import { onceRetry } from "../retry-fidelity.ts";
import {
  VOICE_CONNECTION_DROPPED,
  VOICE_MIC_DENIED,
  VOICE_MIC_MISSING,
  VOICE_SIGN_IN_REQUIRED,
  VOICE_START_FAILED,
} from "./errors.ts";

export type { HonestFailureKind };
export { onceRetry };

export type SpeakFailureClass = { kind: HonestFailureKind; message: string };

export type SpeakRetryParams = {
  correlationId: string;
  /** Transcript was accepted by the chat turn, or the reply is already in the thread. */
  chatCommitted: boolean;
  transcript: string | null;
  reply: string | null;
  audio: string | null;
  /** Exact text passed to Speak. Not trimmed. */
  text: string;
  messageId: string;
  /** Voice id captured with the attempt. Not trimmed. */
  voiceId: string;
};

export type SpeakActionDeps = {
  session?: () => Promise<unknown>;
  capture?: () => Promise<unknown>;
  transcribe?: (audioBase64: string, mime: string) => Promise<unknown>;
  chatTurn?: (transcript: string) => Promise<unknown>;
  synthesize?: (text: string, voiceId: string) => Promise<unknown>;
  play?: (audio: string) => Promise<void>;
};

export type SpeakActionResult =
  | { ok: true; replayed: boolean; params: SpeakRetryParams }
  | { ok: false; noop: boolean; kind: HonestFailureKind; message: string; params: SpeakRetryParams };

const PROVIDER_MISSING = `${HONEST_FAILURE_MESSAGES.model_unconfigured} No speech key is configured. Nothing was transcribed or spoken.`;

/** Strip credentials and raw provider bodies before a message is shown or logged. */
export function sanitizeSpeakMessage(raw: string): string {
  let text = raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/(?:xai|sk-or|sk)-[A-Za-z0-9_-]{6,}/gi, "[redacted]");
  text = text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+/g, "[redacted]");
  if (/^\s*[{[]/.test(text) && text.length > 60) return VOICE_START_FAILED;
  text = text.replace(/\{[\s\S]{20,}\}/g, "[redacted]");
  return text.trim().slice(0, 300);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function failureText(caught: unknown): string {
  if (typeof caught === "string") return caught;
  if (caught instanceof Error) return caught.message;
  const rec = asRecord(caught);
  if (!rec) return "";
  const rpcError = asRecord(rec.error);
  if (rpcError && typeof rpcError.message === "string") return rpcError.message;
  if (typeof rec.text === "string" && rec.text.trim()) return rec.text;
  if (typeof rec.error === "string") return rec.error;
  if (typeof rec.message === "string") return rec.message;
  const rpc = asRecord(rec.rpc);
  if (rpc?.isError === true && Array.isArray(rpc.content)) {
    return rpc.content.map((part) => (asRecord(part) && typeof asRecord(part)?.text === "string" ? String(asRecord(part)?.text) : "")).join("\n");
  }
  return "";
}

function explicitSuccess(caught: unknown): boolean {
  const rec = asRecord(caught);
  if (!rec || rec.ok !== true) return false;
  const transport = asRecord(rec.transport);
  if (transport && transport.ok === false) return false;
  const rpc = asRecord(rec.rpc);
  if (rpc?.isError === true) return false;
  if (asRecord(rec.error) && typeof asRecord(rec.error)?.message === "string") return false;
  return true;
}

function failureKind(caught: unknown, text: string): HonestFailureKind {
  const rec = asRecord(caught);
  const code = rec && typeof rec.code === "string" ? rec.code : "";
  const status = rec && typeof rec.status === "string" ? rec.status : "";
  const transport = rec ? asRecord(rec.transport) : null;
  if (code === "timeout" || status === "timeout" || /timed out|timeout/i.test(text)) return "chat_timeout";
  if (code === "unauthorized" || status === "unauthorized" || /sign in is required|unauthorized|session expired/i.test(text)) {
    return "auth_required";
  }
  if (code === "missing_config" || status === "missing_config" || /no speech key|not configured/i.test(text)) {
    return "model_unavailable";
  }
  if (/emergency stop is on/i.test(text)) return "emergency_stop_active";
  if (/rate limit|\b429\b/i.test(text)) return "rate_limited";
  if (transport && transport.ok === false) return "network_failure";
  if (/microphone permission|no microphone was found|blocked playback/i.test(text)) return "network_failure";
  if (/could not be reached|failed to fetch|network/i.test(text)) return "network_failure";
  return "network_failure";
}

function failureMessage(kind: HonestFailureKind, text: string): string {
  const clean = sanitizeSpeakMessage(text);
  if (kind === "auth_required") {
    return clean.includes("Sign in is required") ? clean : VOICE_SIGN_IN_REQUIRED;
  }
  if (kind === "chat_timeout") return clean.includes("Timed out") ? clean : CHAT_TIMEOUT_REPLY;
  if (kind === "model_unavailable") return clean.includes("not configured") ? clean : PROVIDER_MISSING;
  if (kind === "emergency_stop_active") return clean || HONEST_FAILURE_MESSAGES.emergency_stop_active;
  if (kind === "rate_limited") return clean || HONEST_FAILURE_MESSAGES.rate_limited;
  if (/microphone permission/i.test(clean)) return VOICE_MIC_DENIED;
  if (/no microphone was found/i.test(clean)) return VOICE_MIC_MISSING;
  if (/blocked playback/i.test(clean)) return clean;
  if (kind === "network_failure") return clean || VOICE_CONNECTION_DROPPED;
  return clean || VOICE_START_FAILED;
}

/** Classify a thrown error or a failed Speak result. HTTP status numbers are not consulted. */
export function classifySpeakFailure(caught: unknown): SpeakFailureClass {
  if (explicitSuccess(caught)) {
    return { kind: "network_failure", message: "" };
  }
  const text = failureText(caught);
  const kind = failureKind(caught, text);
  return { kind, message: failureMessage(kind, text) };
}

export function snapshotSpeakRetryParams(input: {
  correlationId?: string;
  chatCommitted?: boolean;
  transcript?: string | null;
  reply?: string | null;
  audio?: string | null;
  text?: string;
  messageId?: string;
  voiceId?: string;
}): SpeakRetryParams {
  return {
    correlationId: typeof input.correlationId === "string" && input.correlationId.length > 0 ? input.correlationId : crypto.randomUUID(),
    chatCommitted: input.chatCommitted === true,
    transcript: input.transcript == null ? null : input.transcript,
    reply: input.reply == null ? null : input.reply,
    audio: input.audio == null ? null : input.audio,
    text: typeof input.text === "string" ? input.text : "",
    messageId: typeof input.messageId === "string" ? input.messageId : "",
    voiceId: typeof input.voiceId === "string" ? input.voiceId : "",
  };
}

function payloadText(result: unknown): string {
  const rec = asRecord(result);
  if (!rec) return "";
  if (typeof rec.text === "string") return rec.text.trim();
  if (typeof rec.error === "string") return rec.error.trim();
  return "";
}

function failed(result: unknown): boolean {
  if (explicitSuccess(result)) return false;
  const rec = asRecord(result);
  if (!rec) return true;
  if (rec.ok === false) return true;
  const transport = asRecord(rec.transport);
  if (transport && transport.ok === false) return true;
  const rpc = asRecord(rec.rpc);
  if (rpc?.isError === true) return true;
  if (asRecord(rec.error)?.message) return true;
  return false;
}

/**
 * Run Speak, or the safe retry of a previous attempt.
 * A committed chat turn is never sent again: replay TTS for the same reply, or no-op.
 */
export async function runSpeakAction(params: SpeakRetryParams, deps: SpeakActionDeps = {}): Promise<SpeakActionResult> {
  const snap = snapshotSpeakRetryParams(params);
  if (snap.chatCommitted) {
    if (snap.reply && deps.synthesize && deps.play) {
      try {
        const spoken = await deps.synthesize(snap.reply, snap.voiceId);
        if (failed(spoken)) {
          const classified = classifySpeakFailure(spoken);
          return { ok: false, noop: false, ...classified, params: snap };
        }
        const audio = asRecord(spoken) && typeof asRecord(spoken)?.audio === "string" ? String(asRecord(spoken)?.audio) : snap.audio;
        if (audio) await deps.play(audio);
        return { ok: true, replayed: true, params: { ...snap, audio: audio ?? snap.audio } };
      } catch (caught) {
        const classified = classifySpeakFailure(caught);
        return { ok: false, noop: false, ...classified, params: snap };
      }
    }
    if (snap.audio && deps.play) {
      try {
        await deps.play(snap.audio);
        return { ok: true, replayed: true, params: snap };
      } catch (caught) {
        const classified = classifySpeakFailure(caught);
        return { ok: false, noop: false, ...classified, params: snap };
      }
    }
    return {
      ok: false,
      noop: true,
      kind: "model_unavailable",
      message: "The chat turn already finished. Nothing new was sent.",
      params: snap,
    };
  }

  const step = async (run: () => Promise<unknown>): Promise<SpeakFailureClass | null> => {
    try {
      const result = await run();
      if (!failed(result)) return null;
      return classifySpeakFailure(result);
    } catch (caught) {
      return classifySpeakFailure(caught);
    }
  };

  if (deps.session) {
    const failure = await step(deps.session);
    if (failure) return { ok: false, noop: false, ...failure, params: snap };
  }
  let audioIn = "";
  let mime = "audio/webm";
  if (deps.capture) {
    try {
      const captured = await deps.capture();
      if (failed(captured)) {
        const classified = classifySpeakFailure(captured);
        return { ok: false, noop: false, ...classified, params: snap };
      }
      const rec = asRecord(captured);
      if (typeof rec?.mime === "string" && rec.mime) mime = rec.mime;
      audioIn = rec && typeof rec.audioBase64 === "string" ? rec.audioBase64 : "";
    } catch (caught) {
      const classified = classifySpeakFailure(caught);
      return { ok: false, noop: false, ...classified, params: snap };
    }
  }
  let transcript = snap.transcript;
  if (deps.transcribe) {
    try {
      const transcribed = await deps.transcribe(audioIn, mime);
      if (failed(transcribed)) {
        const classified = classifySpeakFailure(transcribed);
        return { ok: false, noop: false, ...classified, params: snap };
      }
      transcript = payloadText(transcribed) || transcript;
    } catch (caught) {
      const classified = classifySpeakFailure(caught);
      return { ok: false, noop: false, ...classified, params: snap };
    }
  }
  let reply = snap.reply;
  if (deps.chatTurn && transcript) {
    const sent: SpeakRetryParams = { ...snap, chatCommitted: true, transcript, reply };
    try {
      const chat = await deps.chatTurn(transcript);
      if (failed(chat)) {
        const classified = classifySpeakFailure(chat);
        return { ok: false, noop: false, ...classified, params: sent };
      }
      reply = payloadText(chat) || reply;
    } catch (caught) {
      const classified = classifySpeakFailure(caught);
      return { ok: false, noop: false, ...classified, params: sent };
    }
  }
  const committed: SpeakRetryParams = {
    ...snap,
    chatCommitted: Boolean(snap.chatCommitted || (transcript && reply)),
    transcript,
    reply,
  };
  if (reply && deps.synthesize && deps.play) {
    try {
      const spoken = await deps.synthesize(reply, committed.voiceId);
      if (failed(spoken)) {
        const classified = classifySpeakFailure(spoken);
        return { ok: false, noop: false, ...classified, params: committed };
      }
      const audio = asRecord(spoken) && typeof asRecord(spoken)?.audio === "string" ? String(asRecord(spoken)?.audio) : null;
      if (audio) await deps.play(audio);
      return { ok: true, replayed: false, params: { ...committed, audio } };
    } catch (caught) {
      const classified = classifySpeakFailure(caught);
      return { ok: false, noop: false, ...classified, params: committed };
    }
  }
  return { ok: true, replayed: false, params: committed };
}
