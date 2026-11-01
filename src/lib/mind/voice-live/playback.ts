/**
 * Gapless live playback via LiveSpeakerGain (GainNode mute/volume).
 * Barge-in also interrupts SharedAudioOutput so message Speak shares cutoff.
 */

import { LiveSpeakerGain, readStoredVolume } from "./speaker-gain.ts";

export type LivePlayback = {
  playDeltaBase64: (b64: string) => Promise<void>;
  interrupt: () => void;
  get isPlaying(): boolean;
  reset: () => void;
  speaker: LiveSpeakerGain;
};

export function createLivePlayback(speaker?: LiveSpeakerGain): LivePlayback {
  const sp =
    speaker ??
    new LiveSpeakerGain(
      readStoredVolume(typeof localStorage === "undefined" ? null : localStorage),
    );
  return {
    speaker: sp,
    async playDeltaBase64(b64: string) {
      if (!b64) return;
      await sp.playPcm16Base64(b64);
    },
    interrupt() {
      sp.interrupt();
    },
    get isPlaying() {
      return sp.isPlaying;
    },
    reset() {
      sp.interrupt();
    },
  };
}
