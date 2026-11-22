export type SpeakPhase = "idle" | "listening" | "submitted" | "speaking";

export function createSpeakTurn() {
  let phase: SpeakPhase = "idle";
  let session = 0;
  let playback = 0;
  let activePlayback = 0;

  return {
    phase: () => phase,
    start() {
      session += 1;
      playback += 1;
      phase = "listening";
      return session;
    },
    endTurn(text: string): { session: number; text: string } | null {
      if (phase !== "listening") return null;
      const finalText = text.trim();
      if (!finalText) return null;
      phase = "submitted";
      return { session, text: finalText };
    },
    speak(sessionId: number): number | null {
      if (phase !== "submitted" || sessionId !== session) return null;
      playback += 1;
      activePlayback = playback;
      phase = "speaking";
      return activePlayback;
    },
    interrupt(): boolean {
      if (phase !== "speaking") return false;
      playback += 1;
      phase = "listening";
      return true;
    },
    acceptAudio(token: number): boolean {
      return phase === "speaking" && token === activePlayback && token === playback;
    },
  };
}
