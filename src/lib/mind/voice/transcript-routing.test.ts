import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeVoiceModeTranscript } from "./transcript-routing.ts";

describe("routeVoiceModeTranscript", () => {
  it("keeps overlay text but clears composer draft", () => {
    const r = routeVoiceModeTranscript("  What time is it?  ");
    assert.equal(r.overlayTranscript, "What time is it?");
    assert.equal(r.composerDraft, "");
    assert.equal(r.sendAsChatTurn, true);
  });

  it("rejects empty transcripts", () => {
    const r = routeVoiceModeTranscript("   ");
    assert.equal(r.sendAsChatTurn, false);
    assert.equal(r.composerDraft, "");
  });
});
