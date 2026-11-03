/**
 * Test-only fake mic / AudioContext so live-session VAD + barge-in can run
 * without a real microphone or browser AudioContext.
 */

export type FakeAudioTrack = {
  kind: "audio";
  readyState: "live" | "ended";
  stop: () => void;
  enabled: boolean;
};

export type FakeMediaStream = {
  getAudioTracks: () => FakeAudioTrack[];
  getTracks: () => FakeAudioTrack[];
  getVideoTracks: () => [];
};

export function createFakeAudioStream(): {
  stream: FakeMediaStream;
  track: FakeAudioTrack;
} {
  const track: FakeAudioTrack = {
    kind: "audio",
    readyState: "live",
    enabled: true,
    stop() {
      this.readyState = "ended";
    },
  };
  const stream: FakeMediaStream = {
    getAudioTracks: () => (track.readyState === "ended" ? [] : [track]),
    getTracks: () => (track.readyState === "ended" ? [] : [track]),
    getVideoTracks: () => [],
  };
  return { stream, track };
}

type Processor = {
  connect: (dest?: unknown) => void;
  disconnect: () => void;
  onaudioprocess: ((ev: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void) | null;
};

type Source = { connect: (dest: unknown) => void; disconnect: () => void };
type Gain = { gain: { value: number }; connect: (dest: unknown) => void; disconnect: () => void };

/** Install a minimal AudioContext so LiveMicStream.start() works in Node. */
export function installFakeAudioContext(): () => void {
  const g = globalThis as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  const prev = { AudioContext: g.AudioContext, webkitAudioContext: g.webkitAudioContext };

  class FakeAudioContext {
    sampleRate = 24_000;
    state: "running" | "suspended" | "closed" = "running";
    destination = {};
    createMediaStreamSource(_stream: unknown): Source {
      return {
        connect() {
          /* sum into processor */
        },
        disconnect() {
          /* */
        },
      };
    }
    createScriptProcessor(_bufferSize: number, _inCh: number, _outCh: number): Processor {
      const node: Processor = {
        onaudioprocess: null,
        connect() {
          /* */
        },
        disconnect() {
          /* */
        },
      };
      // Emit one silent frame so onPcm16 can run after start.
      queueMicrotask(() => {
        node.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => new Float32Array(128),
          },
        });
      });
      return node;
    }
    createGain(): Gain {
      return {
        gain: { value: 0 },
        connect() {
          /* */
        },
        disconnect() {
          /* */
        },
      };
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }

  g.AudioContext = FakeAudioContext;
  g.webkitAudioContext = FakeAudioContext;
  return () => {
    g.AudioContext = prev.AudioContext;
    g.webkitAudioContext = prev.webkitAudioContext;
  };
}
