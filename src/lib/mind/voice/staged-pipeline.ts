/** Independent speech input, answer, and output. A text model need not implement audio. */
export type SpeechInput = "handy" | "xai" | "openai";
export type SpeechOutput = "browser" | "xai" | "openai" | "none";
export type SpeakSelection = { input: SpeechInput; output: SpeechOutput };
export type SpeakStageReceipt = { input: string; answer: string; model?: string; output: string; spoken: boolean };
type Failure = { ok: false; error: string };
export const STAGED_SPEAK_KEY = "amcos.speak.stages.v1";

export function loadSpeakSelection(storage: Pick<Storage, "getItem">): SpeakSelection {
  try {
    const raw = JSON.parse(storage.getItem(STAGED_SPEAK_KEY) ?? "{}");
    return { input: ["handy", "xai", "openai"].includes(raw.input) ? raw.input : "handy", output: ["browser", "xai", "openai", "none"].includes(raw.output) ? raw.output : "browser" };
  } catch { return { input: "handy", output: "browser" }; }
}

export async function runStagedSpeak(input: {
  text?: string; selection: SpeakSelection; freeOnly: boolean;
  isCurrent: () => boolean; isMuted: () => boolean;
}, deps: {
  capture: () => Promise<{ ok: true; audioBase64: string; mime: string } | Failure>;
  transcribe: (audio: { audioBase64: string; mime: string }, provider: SpeechInput) => Promise<{ ok: true; text: string; provider: string } | Failure>;
  answer: (text: string) => Promise<{ ok: true; text: string; provider: string; model?: string } | Failure>;
  output: (text: string, provider: SpeechOutput) => Promise<{ ok: true; provider: string } | Failure>;
}): Promise<{ ok: boolean; text?: string; error?: string; receipt: SpeakStageReceipt }> {
  const receipt: SpeakStageReceipt = { input: input.text ? "typed" : "not run", answer: "not run", output: "not run", spoken: false };
  const stopped = (text?: string) => ({ ok: false, text, error: "Call ended or interrupted. No later speech stage was started.", receipt });
  if (!input.isCurrent()) return stopped();
  let text = input.text?.trim() ?? "";
  if (!text) {
    if (input.freeOnly && input.selection.input !== "handy") return { ok: false, error: "Free-only mode blocks cloud transcription. Select local Handy or type your message.", receipt };
    const captured = await deps.capture();
    if (!input.isCurrent()) return stopped();
    if (!captured.ok) return { ok: false, error: captured.error, receipt };
    const transcript = await deps.transcribe(captured, input.selection.input);
    if (!input.isCurrent()) return stopped();
    if (!transcript.ok) return { ok: false, error: transcript.error, receipt };
    receipt.input = transcript.provider;
    text = transcript.text.trim();
    if (!text) return { ok: false, error: "No words were recognized. Nothing was sent to an answer model.", receipt };
  }
  const answer = await deps.answer(text);
  if (!answer.ok) return { ok: false, error: answer.error, receipt };
  receipt.answer = answer.provider || "not reported"; receipt.model = answer.model;
  if (!input.isCurrent()) return stopped(answer.text);
  if (input.isMuted() || input.selection.output === "none") return { ok: true, text: answer.text, receipt: { ...receipt, output: input.isMuted() ? "muted" : "text only" } };
  if (input.freeOnly && input.selection.output !== "browser") return { ok: false, text: answer.text, error: "The answer is saved. Free-only mode blocks cloud speech; select browser speech or text only.", receipt };
  const spoken = await deps.output(answer.text, input.selection.output);
  if (!input.isCurrent()) return stopped(answer.text);
  if (!spoken.ok) return { ok: false, text: answer.text, error: spoken.error, receipt };
  return { ok: true, text: answer.text, receipt: { ...receipt, output: spoken.provider, spoken: true } };
}
