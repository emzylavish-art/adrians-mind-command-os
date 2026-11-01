/**
 * Tiny pub/sub for composer keystrokes and voice partial chunks.
 * Voice lane already emits onPartialTranscript; call pushVoiceChunk there.
 */
import type { IntentSource } from "./types.ts";

export type IntentSourceEvent = {
  text: string;
  source: IntentSource;
  at: number;
};

type Listener = (event: IntentSourceEvent) => void;

const listeners = new Set<Listener>();

let last: IntentSourceEvent = { text: "", source: "keystroke", at: 0 };

export function getLastIntentSource(): IntentSourceEvent {
  return last;
}

export function subscribeIntentSource(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(text: string, source: IntentSource): void {
  const cleaned = typeof text === "string" ? text : "";
  last = { text: cleaned, source, at: Date.now() };
  for (const listener of listeners) {
    try {
      listener(last);
    } catch {
      /* listener errors must not break input */
    }
  }
  if (typeof document !== "undefined") {
    try {
      document.dispatchEvent(
        new CustomEvent("mind:intent-source", { detail: last }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Call on every composer keystroke / ask input change. */
export function pushComposerText(text: string): void {
  publish(text, "keystroke");
}

/**
 * Call with each voice partial / interim transcript chunk.
 * Wire from RealtimeVoiceSession onPartialTranscript (and dictation partials if any).
 */
export function pushVoiceChunk(text: string): void {
  publish(text, "voice");
}

/** Test helper */
export function resetIntentSourceBus(): void {
  listeners.clear();
  last = { text: "", source: "keystroke", at: 0 };
}
