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
});
