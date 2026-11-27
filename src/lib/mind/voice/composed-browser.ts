import { captureSpeakUtterance } from "./capture-utterance.ts";
import { sharedAudioOutput } from "./audio-output.ts";
import type { BrowserSpeechCtor, BrowserSpeechRec } from "../whisper-flow/session.ts";
import { speechEngineLabel, type SpeechEngine, type VoiceRoutePreferences } from "./route-preferences.ts";

export function captureBrowserSpeech(signal: AbortSignal): Promise<{ text: string; provider: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Voice turn canceled.")); return; }
    const host = globalThis as unknown as { SpeechRecognition?: BrowserSpeechCtor; webkitSpeechRecognition?: BrowserSpeechCtor };
    const Ctor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Ctor) { reject(new Error("Browser speech recognition is unavailable. Choose a configured transcription provider in Voice settings.")); return; }
    const rec: BrowserSpeechRec = new Ctor();
    let settled = false;
    const finish = (text?: string, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      rec.abort?.();
      if (error) reject(new Error(error));
      else resolve({ text: text || "", provider: "Browser speech (browser-managed service)" });
    };
    const abort = () => finish(undefined, "Voice turn canceled.");
    const timer = setTimeout(() => finish(undefined, "No final transcript arrived. Nothing was sent to the answer model."), 30_000);
    rec.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const parts: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal !== false && result?.[0]?.transcript) parts.push(result[0].transcript);
      }
      if (parts.length) finish(parts.join(" "));
    };
    rec.onerror = (event) => finish(undefined, event.error === "not-allowed" ? "Microphone permission was denied." : `Browser recognition failed (${event.error || "unknown"}). Nothing was substituted.`);
    rec.onend = () => { if (!settled) finish(undefined, "No words were recognized. Nothing was sent to the answer model."); };
    signal.addEventListener("abort", abort, { once: true });
    try { rec.start(); } catch { finish(undefined, "Browser speech could not start. Check microphone permission."); }
  });
}

async function speechRequest(path: "stt" | "tts", body: Record<string, unknown>, signal: AbortSignal) {
  const response = await fetch(`/api/mind/voice/${path}`, {
    method: "POST", credentials: "same-origin", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; text?: string; audio?: string; provider?: string; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "The selected speech service did not complete the request. Nothing was substituted.");
  return result;
}

export async function captureComposedSpeech(route: VoiceRoutePreferences, freeOnly: boolean, signal: AbortSignal) {
  if (route.sttProvider === "browser") return captureBrowserSpeech(signal);
  if (freeOnly) throw new Error("Free-only mode keeps cloud transcription off.");
  const audio = await captureSpeakUtterance({ signal, maxMs: 12_000 });
  if (!audio.ok) throw new Error("canceled" in audio ? audio.message : audio.message);
  if (signal.aborted) throw new Error("Voice turn canceled.");
  const result = await speechRequest("stt", { ...audio, provider: route.sttProvider, fallbackProvider: route.sttFallbackProvider, freeOnly }, signal);
  if (!result.text?.trim()) throw new Error("No words were recognized. No answer was requested.");
  return { text: result.text, provider: result.provider || "Transcription provider not reported" };
}

export async function playComposedSpeech(text: string, provider: SpeechEngine, options: {
  signal: AbortSignal; freeOnly: boolean; voiceId: string;
  output: () => { muted: boolean; volume: number; rate: number };
}): Promise<{ provider: string }> {
  if (options.signal.aborted) throw new Error("Voice turn canceled.");
  if (provider === "browser") {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") throw new Error("Browser speech output is unavailable. Choose a configured speech engine.");
    await new Promise<void>((resolve, reject) => {
      const settings = options.output();
      if (settings.muted || options.signal.aborted) { resolve(); return; }
      const speech = new SpeechSynthesisUtterance(text);
      speech.volume = Math.min(1, Math.max(0, settings.volume));
      speech.rate = settings.rate;
      let settled = false;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener("abort", abort);
        if (error) reject(new Error(error)); else resolve();
      };
      const abort = () => { speechSynthesis.cancel(); finish(); };
      speech.onend = () => finish();
      speech.onerror = () => finish(options.output().muted || options.signal.aborted ? undefined : "Browser speech playback did not finish.");
      options.signal.addEventListener("abort", abort, { once: true });
      speechSynthesis.speak(speech);
    });
    return { provider: speechEngineLabel(provider) };
  }
  if (options.freeOnly) throw new Error("Free-only mode keeps cloud speech output off.");
  const result = await speechRequest("tts", { text, provider, fallbackProvider: null, voiceId: options.voiceId, freeOnly: options.freeOnly }, options.signal);
  if (!result.audio) throw new Error("The selected speech engine returned no audio.");
  const settings = options.output();
  if (options.signal.aborted || settings.muted) return { provider: result.provider || "Speech provider not reported" };
  const stop = () => sharedAudioOutput.interrupt();
  options.signal.addEventListener("abort", stop, { once: true });
  try { await sharedAudioOutput.playMpegBase64(result.audio, { rate: settings.rate, volume: settings.volume }); }
  finally { options.signal.removeEventListener("abort", stop); }
  return { provider: result.provider || "Speech provider not reported" };
}
