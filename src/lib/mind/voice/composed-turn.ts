import type { SpeechEngine, VoiceRoutePreferences } from "./route-preferences.ts";

export type VoiceAnswer = { reply?: string; error?: string; provider?: string; model?: string };
export type VoiceStageReceipt = { stage: "transcription" | "answer" | "speech"; provider: string; model?: string };
export type ComposedVoiceResult = { ok: boolean; transcript?: string; reply?: string; error?: string; canceled?: boolean; receipts: VoiceStageReceipt[] };
export type ComposedVoiceDeps = {
  capture: (signal: AbortSignal) => Promise<{ text: string; provider: string }>;
  /** The ordinary chat pipeline owns transcript persistence and operation receipts. */
  answer: (text: string) => Promise<VoiceAnswer>;
  speak: (text: string, provider: SpeechEngine, signal: AbortSignal) => Promise<{ provider: string }>;
  canSpeak?: () => boolean;
  onPhase?: (phase: "listening" | "answering" | "speaking") => void;
};

/** One utterance, one answer, one optional output. No inference or audio fallback here. */
export async function runComposedVoiceTurn(input: {
  route: VoiceRoutePreferences; signal: AbortSignal; text?: string; freeOnly?: boolean;
}, deps: ComposedVoiceDeps): Promise<ComposedVoiceResult> {
  const receipts: VoiceStageReceipt[] = [];
  let transcript = input.text?.trim() || "";
  let reply = "";
  const canceled = (): ComposedVoiceResult => ({ ok: false, canceled: true, transcript, reply, receipts });
  if (input.signal.aborted) return canceled();
  if (input.freeOnly && ((!transcript && input.route.sttProvider !== "browser") || input.route.ttsProvider !== "browser")) {
    return { ok: false, error: "Free-only mode requires browser speech for listening and output. No cloud speech request was made.", receipts };
  }
  try {
    if (!transcript) {
      deps.onPhase?.("listening");
      const heard = await deps.capture(input.signal);
      if (input.signal.aborted) return canceled();
      transcript = heard.text.trim();
      receipts.push({ stage: "transcription", provider: heard.provider });
    }
    if (!transcript) return { ok: false, error: "No words were recognized. No answer was requested.", receipts };
    deps.onPhase?.("answering");
    const answer = await deps.answer(transcript);
    if (input.signal.aborted) return canceled();
    reply = answer.reply?.trim() || "";
    if (answer.error || !reply) return { ok: false, transcript, reply, error: answer.error || "The selected answer provider returned no text.", receipts };
    receipts.push({ stage: "answer", provider: answer.provider || "Provider not reported", model: answer.model });
    if (deps.canSpeak?.() === false) return { ok: true, transcript, reply, receipts };
    deps.onPhase?.("speaking");
    const spoken = await deps.speak(reply, input.route.ttsProvider, input.signal);
    if (input.signal.aborted) return canceled();
    receipts.push({ stage: "speech", provider: spoken.provider });
    return { ok: true, transcript, reply, receipts };
  } catch (error) {
    if (input.signal.aborted) return canceled();
    return { ok: false, transcript, reply, receipts, error: error instanceof Error ? error.message : "The selected voice stage did not finish." };
  }
}
