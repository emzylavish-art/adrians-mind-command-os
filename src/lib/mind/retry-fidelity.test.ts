import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  historyForDeliver,
  resolveChatMessages,
  shouldBlockForEmergencyStop,
  snapshotImages,
} from "./retry-fidelity.ts";

describe("retry fidelity", () => {
  it("preserves images byte-identically across snapshot", () => {
    const images = [{ dataUrl: "data:image/png;base64,aaa", name: "eb-red.png" }];
    const snap = snapshotImages(images);
    assert.deepEqual(snap, images);
    assert.notEqual(snap, images);
  });

  it("keeps original history on resume using the live chat that already stored the user turn", () => {
    const prior = [{ role: "user" as const, content: "verifier first message" }];
    const withSecond = [...prior, { role: "user" as const, content: "verifier second message in chat" }];
    // First attempt (resume=false) used prior only.
    assert.deepEqual(historyForDeliver(prior, false), prior);
    // After the user turn was written, Retry (resume=true) must slice it off the LIVE chat.
    const live = resolveChatMessages([{ id: "c1", messages: withSecond }], "c1", { id: "c1", messages: prior });
    assert.deepEqual(historyForDeliver(live, true), prior);
  });

  it("does not drop history when a stale chat object is used for resume (documents the bug)", () => {
    const prior = [{ role: "user" as const, content: "verifier first message" }];
    // Stale chat never received the second user turn — resume slice empties it.
    assert.deepEqual(historyForDeliver(prior, true), []);
  });

  it("blocks only on live halted, not a stale source.halted after Clear stop", () => {
    assert.equal(shouldBlockForEmergencyStop(true, false), true);
    assert.equal(shouldBlockForEmergencyStop(false, true), false);
    assert.equal(shouldBlockForEmergencyStop(false, false), false);
  });
});
