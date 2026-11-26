import { openAiSpeech, openAiTranscribe } from "./provider-fallback.ts";
import { callXaiTts } from "./tts-call.ts";
import { transcribeWavBytes } from "./stt.ts";
import { resolveVoiceApiKey } from "./keys.ts";
import { isSpeechProviderChoice, type SelectedSpeechCredential } from "./provider-selection.ts";

export async function resolveSelectedSpeechCredential(userId: string, selected: unknown, input: {
  env?: Record<string, string | undefined>;
  secretsPath?: string;
  customCredential?: (userId: string, id: string) => Promise<SelectedSpeechCredential>;
} = {}): Promise<SelectedSpeechCredential> {
  const choice = selected ?? "xai"; // Legacy clients retain their existing xAI route; no alternate key is tried.
  if (!isSpeechProviderChoice(choice)) return { ok: false, error: "The selected speech provider is not compatible with this server route. Nothing was substituted." };
  if (choice.startsWith("custom:")) {
    const resolver = input.customCredential || (async (owner: string, id: string) => (await import("../ai-provider-config.server.ts")).aiProviderSpeechCredential(owner, id));
    return resolver(userId, choice.slice(7));
  }
  const env = input.env || process.env;
  const key = choice === "xai" ? resolveVoiceApiKey(env, input.secretsPath) : env.OPENAI_API_KEY?.trim();
  return key ? { ok: true, provider: choice as "xai" | "openai", key } : { ok: false, error: `The selected ${choice === "xai" ? "xAI" : "OpenAI"} speech provider is not configured. No fallback was called.` };
}

export async function transcribeSelected(input: { selected: SelectedSpeechCredential; bytes: Uint8Array; filename?: string; mime?: string; fetchImpl?: typeof fetch }) {
  if (!input.selected.ok) return { ok: false as const, error: input.selected.error, provider: null };
  const selected = input.selected;
  const result = selected.provider === "xai"
    ? await transcribeWavBytes({ ...input, apiKey: selected.key })
    : await openAiTranscribe({ ...input, apiKey: selected.key, fetchImpl: input.fetchImpl || fetch });
  return result.ok ? { ...result, provider: selected.provider === "xai" ? "xAI" : "OpenAI" } : { ...result, provider: null };
}

export async function speakSelected(input: { selected: SelectedSpeechCredential; text: string; voiceId?: string; fetchImpl?: typeof fetch }) {
  if (!input.selected.ok) return { ok: false as const, error: input.selected.error, provider: null };
  const selected = input.selected;
  const result = selected.provider === "xai"
    ? await callXaiTts({ ...input, apiKey: selected.key })
    : await openAiSpeech({ ...input, apiKey: selected.key, fetchImpl: input.fetchImpl || fetch });
  return result.ok ? { ...result, mime: "audio/mpeg" as const, provider: selected.provider === "xai" ? "xAI" : "OpenAI" } : { ...result, provider: null };
}
