import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveMicStream } from "./mic-stream.ts";

describe("LiveMicStream screen-audio mix API", () => {
  it("tracks mix enablement without a running graph", () => {
    const mic = new LiveMicStream();
    assert.equal(mic.isScreenMixEnabled, true);
    assert.equal(mic.isMixingScreenAudio, false);
    mic.setScreenMixEnabled(false);
    assert.equal(mic.isScreenMixEnabled, false);
    mic.setScreenMixEnabled(true);
    assert.equal(mic.isScreenMixEnabled, true);
  });

  it("attach/detach display audio is safe before start (no AudioContext)", () => {
    const mic = new LiveMicStream();
    const fakeTrack = {
      readyState: "live",
      kind: "audio",
      stop() {
        this.readyState = "ended";
      },
    };
    const stream = {
      getAudioTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack],
    } as unknown as MediaStream;
    mic.attachDisplayAudio(stream);
    assert.equal(mic.hasDisplayAudio, true);
    // Not running → not actively mixing yet
    assert.equal(mic.isMixingScreenAudio, false);
    mic.detachDisplayAudio({ stopTracks: true });
    assert.equal(mic.hasDisplayAudio, false);
    assert.equal(fakeTrack.readyState, "ended");
  });
});
