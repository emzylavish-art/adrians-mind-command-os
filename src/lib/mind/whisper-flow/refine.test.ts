import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refineDictationLocal } from "./refine.ts";

describe("whisper-flow refine (local)", () => {
  it("strips fillers and capitalizes", () => {
    const r = refineDictationLocal("um hello there uh");
    assert.equal(r.text, "Hello there.");
    assert.ok(r.fillersRemoved >= 2);
    assert.equal(r.capitalized, true);
    assert.equal(r.punctuated, true);
  });

  it("turns questions into question marks", () => {
    const r = refineDictationLocal("what time is it");
    assert.equal(r.text, "What time is it?");
  });

  it("handles scratch that as discard + undo previous", () => {
    const r = refineDictationLocal("scratch that");
    assert.equal(r.discardSegment, true);
    assert.equal(r.undoPrevious, true);
    assert.equal(r.text, "");
  });

  it("keeps text after mid-utterance scratch that", () => {
    const r = refineDictationLocal("buy milk scratch that buy eggs");
    assert.equal(r.discardSegment, false);
    assert.match(r.text, /^Buy eggs\.?$/);
    assert.equal(r.undoPrevious, true);
  });

  it("applies no I mean self-correction", () => {
    const r = refineDictationLocal("no I mean schedule the meeting");
    assert.match(r.text, /^Schedule the meeting\.?$/);
  });
});
