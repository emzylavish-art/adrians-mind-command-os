import type { AvatarPresence } from "./presence.ts";

export type AvatarSession = {
  presence: AvatarPresence;
  utterance: string;
  startedAt: number | null;
};

const listeners = new Set<() => void>();

let session: AvatarSession = {
  presence: "idle",
  utterance: "",
  startedAt: null,
};

function emit() {
  for (const listener of listeners) listener();
}

export function readAvatarSession(): AvatarSession {
  return session;
}

export function subscribeAvatarSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAvatarPresence(presence: AvatarPresence, now = Date.now()): void {
  if (session.presence === presence) return;
  session = {
    ...session,
    presence,
    startedAt: presence === "speaking" ? (session.startedAt ?? now) : null,
    utterance: presence === "speaking" || presence === "processing" ? session.utterance : "",
  };
  emit();
}

/** Called with the exact text about to be spoken. Does not invent audio. */
export function noteSpokenText(text: string, now = Date.now()): void {
  const utterance = text.replace(/\s+/g, " ").trim().slice(0, 2000);
  session = { presence: "speaking", utterance, startedAt: now };
  emit();
}

export function resetAvatarSession(): void {
  session = { presence: "idle", utterance: "", startedAt: null };
  emit();
}
