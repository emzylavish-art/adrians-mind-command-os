import type { SharedAudioOutput } from "./audio-output.ts";
import { createSpeakTurn } from "./one-audio.ts";

export const speakTurn = createSpeakTurn();

/** Cancel message-level Speak (TTS fetch + shared speaker + browser speechSynthesis). */
export function interruptMessageSpeak(input: {
  sharedAudio: SharedAudioOutput;
  abortSpeak?: AbortController | null;
  speechSynthesis?: { cancel: () => void } | null;
}): void {
  try {
    input.abortSpeak?.abort();
  } catch {
    /* ignore */
  }
  try {
    input.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  input.sharedAudio.interrupt();
  speakTurn.interrupt();
}

export function shouldIgnoreSpeakResult(generation: number, activeGeneration: number, aborted: boolean): boolean {
  return aborted || generation !== activeGeneration;
}
