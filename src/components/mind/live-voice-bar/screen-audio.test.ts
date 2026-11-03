import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeScreenAudio, screenShareUnavailableMessage } from "./screen-audio.ts";

describe("screen audio honesty", () => {
  it("surfaces a clear note when the display stream has no audio tracks", () => {
    const status = describeScreenAudio({ getAudioTracks: () => [] });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.hasAudio, false);
      assert.match(status.notice || "", /Screen audio is not available/i);
    }
  });

  it("does not silently claim display audio is in the call when tracks exist", () => {
    const status = describeScreenAudio({ getAudioTracks: () => [{}] });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.hasAudio, true);
      assert.match(status.notice || "", /not mixed into the call/i);
    }
  });

  it("has a non-empty unavailable message", () => {
    assert.match(screenShareUnavailableMessage(), /Screen share/i);
  });
});
