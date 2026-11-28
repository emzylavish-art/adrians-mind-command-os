import { randomUUID } from "node:crypto";
import { dispatchContext, reserveDispatchAttempt, runSettledDispatch, type ReserveDispatch, type SettleDispatch } from "../dispatch-attempt.ts";
import { authorizeExternalResource } from "../external-resource-call.server.ts";
import { transcribeWithHandy } from "../whisper-flow/provider.ts";
import { OPENAI_STT_MODEL } from "./provider-fallback.ts";
import { isSpeechProviderChoice, type SelectedSpeechCredential } from "./provider-selection.ts";
import { resolveSelectedSpeechCredential, transcribeSelected } from "./provider-selection.server.ts";
import { STT_MODEL } from "./stt.ts";
import { parseTranscriptionPolicy } from "./transcription-policy.ts";
import { createVoiceUsageTracker, type VoiceUsageWriter } from "./usage.server.ts";

type Result = { ok: true; text: string; provider: string } | {
  ok: false; error: string; code?: string; dispatched?: false; approvalId?: string;
};
type Dependencies = {
  env?: Record<string, string | undefined>; secretsPath?: string; fetchImpl?: typeof fetch;
  reserve?: ReserveDispatch; settle?: SettleDispatch; recordUsage?: VoiceUsageWriter;
  halted?: (owner: string) => Promise<boolean>;
  authorize?: (owner: string, provider: "xAI" | "OpenAI") => Promise<(ok: boolean, requestId?: string, dispatched?: boolean) => Promise<void>>;
  customCredential?: (userId: string, id: string) => Promise<SelectedSpeechCredential>;
};

export async function dispatchTranscription(owner: string, body: Record<string, unknown>, audio: {
  audioBase64: string; mime?: string; filename?: string; bytes: Uint8Array;
}, options: { allowHandy: boolean; deps?: Dependencies }): Promise<{ result: Result; status: number }> {
  const deps = options.deps ?? {};
  let attempted = false;
  const refuse = (error: string, status = 200, code?: string, approvalId?: string) => ({
    status, result: { ok: false as const, error, code, approvalId, ...(!attempted ? { dispatched: false as const } : {}) },
  });
  const legacy = parseTranscriptionPolicy(body.transcriptionPolicy);
  if (!legacy) return refuse("Review the transcription preference before sending a recording.", 400);
  const primary = body.provider ?? (options.allowHandy && !body.transcriptionPolicy ? undefined : legacy.provider);
  if (body.transcriptionPolicy && body.provider && primary !== legacy.provider) return refuse("Transcription destinations disagree. Review the service selection.", 400);
  const legacyFallback = legacy.allowFallback ? legacy.provider === "xai" ? "openai" : "xai" : null;
  const alternate = body.fallbackProvider === undefined ? legacyFallback : body.fallbackProvider;
  if (body.transcriptionPolicy && body.fallbackProvider !== undefined && alternate !== legacyFallback) return refuse("The alternate transcription preferences disagree.", 400);
  const valid = (choice: unknown) => isSpeechProviderChoice(choice) || (options.allowHandy && choice === "handy");
  if (!valid(primary) || (alternate != null && (!valid(alternate) || alternate === primary))) return refuse("Choose a compatible transcription service and a distinct optional alternate.", 400);
  const operationId = typeof body.operationId === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(body.operationId) ? body.operationId : randomUUID();
  const tracker = createVoiceUsageTracker(owner, { operationId, fetchImpl: deps.fetchImpl, record: deps.recordUsage });
  const halted = deps.halted ?? (async id => (await import("../halt.server.ts")).haltIsOn(id));
  for (const choice of alternate == null ? [primary] : [primary, alternate]) {
    if (await halted(owner)) return refuse("Emergency stop is on. Transcription stopped.", 200, "emergency_stop");
    if (choice === "handy") {
      const result = await transcribeWithHandy(audio.bytes, audio.mime, deps.fetchImpl);
      if (result.ok) return { status: 200, result: { ok: true, text: result.text, provider: result.provider } };
      if (choice === primary && alternate && result.code === "provider_rejected") continue;
      return refuse(result.error, 200, result.code);
    }
    if (body.freeOnly === true) return refuse("Free-only mode keeps cloud transcription off.");
    const selected = await resolveSelectedSpeechCredential(owner, choice, deps);
    if (!selected.ok) return refuse(selected.error, 200, "provider_not_configured");
    const provider = selected.provider === "xai" ? "xAI" : "OpenAI";
    const model = selected.provider === "xai" ? STT_MODEL : OPENAI_STT_MODEL;
    const context = dispatchContext({ operationId, taskId: body.taskId ?? operationId, projectId: body.projectId,
      provider: String(choice), model, stage: choice === primary ? "stt" : "stt-fallback", textOnly: false,
      args: { audio: audio.audioBase64, mime: audio.mime, filename: audio.filename } });
    const reserve = await reserveDispatchAttempt(owner, context, deps.reserve);
    if (!reserve.ok) return refuse(reserve.error, reserve.status, "resource_policy", reserve.approvalId);
    const result = await runSettledDispatch(owner, reserve.reservationId, async () => {
      let settle;
      try {
        settle = deps.authorize ? await deps.authorize(owner, provider) : await authorizeExternalResource(owner, String(choice), model, operationId, false, true);
      } catch { return { ok: false as const, dispatched: false as const, code: "resource_policy", error: "Account resource approval is unavailable for the selected transcription service." }; }
      let sent = false;
      try {
        const language = typeof body.language === "string" && /^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(body.language) ? body.language.split("-")[0] : undefined;
        const heard = await transcribeSelected({ selected, ...audio, language, fetchImpl: tracker.fetch("transcription", () => { sent = true; attempted = true; }) });
        if (tracker.error) return { ok: false as const, dispatched: false as const, code: "record_unavailable", error: tracker.error };
        await settle(heard.ok, undefined, sent);
        settle = undefined;
        return heard;
      } finally { if (settle) await settle(false, undefined, sent); }
    }, deps.settle);
    if (result.ok) return { status: 200, result: { ok: true, text: result.text, provider } };
    const code = "code" in result ? result.code : undefined;
    if (choice === primary && alternate && (code === "provider_rejected" || code === "rate_limited")) continue;
    return refuse(result.error, code === "record_unavailable" ? 503 : 200, code);
  }
  return refuse("Transcription did not finish.");
}
