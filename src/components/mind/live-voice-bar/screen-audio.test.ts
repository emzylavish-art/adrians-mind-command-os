import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeScreenAudio,
  readScreenAudioMixEnabled,
  screenAudioFallbackVideoOnlyMessage,
  screenShareUnavailableMessage,
  writeScreenAudioMixEnabled,
} from "./screen-audio.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

describe("screen audio honesty + mix", () => {
  it("surfaces a clear note when the display stream has no audio tracks", () => {
    const status = describeScreenAudio({ getAudioTracks: () => [] });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.hasAudio, false);
      assert.equal(status.mixing, false);
      assert.match(status.notice || "", /Screen audio is not available/i);
    }
  });

  it("reports mixing when tracks exist and mix is enabled", () => {
    const status = describeScreenAudio({ getAudioTracks: () => [{}] }, { mixEnabled: true });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.hasAudio, true);
      assert.equal(status.mixing, true);
      assert.match(status.notice || "", /mixed into the call/i);
      assert.doesNotMatch(status.notice || "", /not mixed/i);
    }
  });

  it("honest fallback when mix is off but tracks exist", () => {
    const status = describeScreenAudio({ getAudioTracks: () => [{}] }, { mixEnabled: false });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.mixing, false);
      assert.match(status.notice || "", /mix is off/i);
    }
  });

  it("persists mix preference", () => {
    const storage = memoryStorage();
    assert.equal(readScreenAudioMixEnabled(storage), true);
    writeScreenAudioMixEnabled(false, storage);
    assert.equal(readScreenAudioMixEnabled(storage), false);
    writeScreenAudioMixEnabled(true, storage);
    assert.equal(readScreenAudioMixEnabled(storage), true);
  });

  it("has non-empty unavailable + video-only fallback messages", () => {
    assert.match(screenShareUnavailableMessage(), /Screen share/i);
    assert.match(screenAudioFallbackVideoOnlyMessage(), /video only/i);
  });
});
