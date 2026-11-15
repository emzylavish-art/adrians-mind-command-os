import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectFromSpeech } from "./eve-projection.ts";

describe("eve projection", () => {
  it("changes the background from the words without waiting for a reply", () => {
    const quiet = projectFromSpeech("");
    const night = projectFromSpeech("project a night sky");
    const ocean = projectFromSpeech("show the ocean");
    assert.equal(quiet.id, "room");
    assert.equal(night.id, "night");
    assert.equal(ocean.id, "ocean");
    assert.notEqual(night.sky, ocean.sky);
  });

  it("projects an unnamed line onto her own computer and leaves the Windows desktop alone", () => {
    const live = projectFromSpeech("project amber glass");
    assert.equal(live.label.includes("amber"), true);
    assert.equal(live.note.includes("Windows desktop is not changed"), true);
  });
});
