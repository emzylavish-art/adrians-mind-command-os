/**
 * Gapless scheduled playback of pcm16 deltas via SharedAudioOutput.
 * Live voice and message Speak share one speaker path / cutoff.
 */

import { SharedAudioOutput, sharedAudioOutput } from "../voice/audio-output.ts";
import { REALTIME_SAMPLE_RATE } from "../voice/realtime-session.ts";

export type LivePlayback = {
  playDeltaBase64: (b64: string) => Promise<void>;
  interrupt: () => void;
  get isPlaying(): boolean;
  /** Bound scheduled source count proxy via SharedAudioOutput. */
  reset: () => void;
};

export function createLivePlayback(output: SharedAudioOutput = sharedAudioOutput): LivePlayback {
  return {
    async playDeltaBase64(b64: string) {
      if (!b64) return;
      await output.playPcm16Base64(b64, { sampleRate: REALTIME_SAMPLE_RATE });
    },
    interrupt() {
      output.interrupt();
    },
    get isPlaying() {
      return output.isPlaying;
    },
    reset() {
      output.interrupt();
    },
  };
}
