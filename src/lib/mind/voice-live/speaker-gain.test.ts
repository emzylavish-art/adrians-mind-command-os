import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readStoredVolume, writeStoredVolume, SPEAKER_VOLUME_KEY } from "./speaker-gain.ts";

describe("speaker-gain volume store", () => {
  it("clamps and recovers corrupted stored volume", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    assert.equal(readStoredVolume(null), 1);
    assert.equal(readStoredVolume(storage), 1);
    mem.set(SPEAKER_VOLUME_KEY, "not-a-number");
    assert.equal(readStoredVolume(storage), 1);
    mem.set(SPEAKER_VOLUME_KEY, "NaN");
    assert.equal(readStoredVolume(storage), 1);
    mem.set(SPEAKER_VOLUME_KEY, "2.5");
    assert.equal(readStoredVolume(storage), 1);
    mem.set(SPEAKER_VOLUME_KEY, "-0.4");
    assert.equal(readStoredVolume(storage), 0);
    assert.equal(writeStoredVolume(0.42, storage), 0.42);
    assert.equal(readStoredVolume(storage), 0.42);
    assert.equal(writeStoredVolume(Number.NaN, storage), 1);
    assert.equal(writeStoredVolume(99, storage), 1);
  });
});
