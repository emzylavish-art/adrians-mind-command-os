import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SharedAudioOutput } from "./audio-output.ts";

describe("SharedAudioOutput", () => {
  it("interrupt clears playing state without throwing when nothing is queued", () => {
    const out = new SharedAudioOutput();
    assert.equal(out.isPlaying, false);
    out.interrupt();
    assert.equal(out.isPlaying, false);
  });

  it("plays PCM chunks consecutively, changes gain during playback, and resets the timeline after interruption", async () => {
    const starts: number[] = [];
    const gain = { gain: { value: 1 }, connect() {} };
    const sources: { onended: (() => void) | null; stop(): void }[] = [];
    class TestContext {
      state = "running";
      currentTime = 5;
      destination = {};
      createGain() { return gain; }
      createBuffer() { return { duration: 0.25, getChannelData: () => new Float32Array(1) }; }
      createBufferSource() {
        const source = {
          onended: null as (() => void) | null,
          playbackRate: { value: 1 },
          connect(target: unknown) { assert.equal(target, gain); },
          start(time: number) { starts.push(time); },
          stop() { this.onended?.(); },
        };
        sources.push(source);
        return source;
      }
    }
    const original = globalThis.AudioContext;
    globalThis.AudioContext = TestContext as unknown as typeof AudioContext;
    try {
      const out = new SharedAudioOutput();
      const first = out.playPcm16(new Uint8Array(2));
      const second = out.playPcm16(new Uint8Array(2));
      assert.deepEqual(starts, [5, 5.25]);
      out.setOutputVolume(0);
      assert.equal(gain.gain.value, 0);
      out.interrupt();
      await Promise.all([first, second]);
      const third = out.playPcm16(new Uint8Array(2));
      assert.deepEqual(starts, [5, 5.25, 5]);
      sources[2].onended?.();
      await third;
    } finally {
      globalThis.AudioContext = original;
    }
  });

  it("interrupt resolves an in-flight playMpegBase64 await (Speak cutoff)", async () => {
    const out = new SharedAudioOutput();
    // Minimal valid-looking base64 so decode succeeds; Audio may not exist in node.
    const AudioStub = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      play() {
        return new Promise<void>(() => {
          /* never resolves — interrupt must finish the SharedAudioOutput promise */
        });
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    const g = globalThis as unknown as { Audio?: typeof Audio; URL?: typeof URL; Blob?: typeof Blob };
    const prevAudio = g.Audio;
    const prevURL = g.URL;
    const prevBlob = g.Blob;
    g.Audio = AudioStub as unknown as typeof Audio;
    g.URL = {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => undefined,
    } as unknown as typeof URL;
    g.Blob = class {
      constructor(_parts?: unknown[], _opts?: unknown) {}
    } as unknown as typeof Blob;

    try {
      const pending = out.playMpegBase64(Buffer.from("ID3").toString("base64"));
      // Allow play() to start
      await Promise.resolve();
      assert.equal(out.isPlaying, true);
      out.interrupt();
      await Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error("playMpeg did not settle after interrupt")), 500)),
      ]);
      assert.equal(out.isPlaying, false);
    } finally {
      g.Audio = prevAudio;
      g.URL = prevURL;
      g.Blob = prevBlob;
    }
  });

  it("rejects when audio.play() is rejected (autoplay blocked)", async () => {
    const out = new SharedAudioOutput();
    const AudioStub = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      play() {
        return Promise.reject(new DOMException("play() failed", "NotAllowedError"));
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    const g = globalThis as unknown as { Audio?: typeof Audio; URL?: typeof URL; Blob?: typeof Blob };
    const prevAudio = g.Audio;
    const prevURL = g.URL;
    const prevBlob = g.Blob;
    g.Audio = AudioStub as unknown as typeof Audio;
    g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined } as unknown as typeof URL;
    g.Blob = class { constructor(_parts?: unknown[], _opts?: unknown) {} } as unknown as typeof Blob;
    try {
      await assert.rejects(
        () => out.playMpegBase64(Buffer.from("ID3fake-audio-bytes-for-test").toString("base64")),
        /blocked|NotAllowedError|play\(\) failed/,
      );
      assert.equal(out.isPlaying, false);
    } finally {
      g.Audio = prevAudio;
      g.URL = prevURL;
      g.Blob = prevBlob;
    }
  });

  it("rejects when audio.play() does not return a promise", async () => {
    const out = new SharedAudioOutput();
    const AudioStub = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      play() {
        return undefined;
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    const g = globalThis as unknown as { Audio?: typeof Audio; URL?: typeof URL; Blob?: typeof Blob };
    const prevAudio = g.Audio;
    const prevURL = g.URL;
    const prevBlob = g.Blob;
    g.Audio = AudioStub as unknown as typeof Audio;
    g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined } as unknown as typeof URL;
    g.Blob = class { constructor(_parts?: unknown[], _opts?: unknown) {} } as unknown as typeof Blob;
    try {
      await assert.rejects(
        () => out.playMpegBase64(Buffer.from("ID3").toString("base64")),
        /blocked playback/,
      );
      assert.equal(out.isPlaying, false);
    } finally {
      g.Audio = prevAudio;
      g.URL = prevURL;
      g.Blob = prevBlob;
    }
  });

  it("publishes a clock when MPEG playback is interrupted", async () => {
    const out = new SharedAudioOutput();
    const clocks: { playing: boolean; current: number; duration: number }[] = [];
    const stop = out.onClock((clock) => clocks.push(clock));
    const AudioStub = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;
      currentTime = 0;
      duration = 1.2;
      src = "";
      play() {
        return Promise.resolve();
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    const g = globalThis as unknown as { Audio?: typeof Audio; URL?: typeof URL; Blob?: typeof Blob };
    const prevAudio = g.Audio;
    const prevURL = g.URL;
    const prevBlob = g.Blob;
    g.Audio = AudioStub as unknown as typeof Audio;
    g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined } as unknown as typeof URL;
    g.Blob = class { constructor(_parts?: unknown[], _opts?: unknown) {} } as unknown as typeof Blob;
    try {
      const pending = out.playMpegBase64(Buffer.from("ID3").toString("base64"));
      await Promise.resolve();
      out.interrupt();
      await pending;
      assert.equal(clocks.at(-1)?.playing, false);
      assert.ok(clocks.some((clock) => clock.playing));
    } finally {
      stop();
      g.Audio = prevAudio;
      g.URL = prevURL;
      g.Blob = prevBlob;
    }
  });
});
