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
