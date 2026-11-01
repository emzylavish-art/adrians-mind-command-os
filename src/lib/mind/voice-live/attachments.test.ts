import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginFrame,
  createFrameGate,
  endFrame,
  REALTIME_NATIVE_INPUT_IMAGE,
  validateAttachment,
} from "./attachments.ts";

describe("live-voice attachments", () => {
  it("validates photo/video/text and rejects junk/huge", () => {
    assert.equal(validateAttachment({ name: "a.jpg", type: "image/jpeg", size: 100 }, "photo").ok, true);
    assert.equal(validateAttachment({ name: "a.mp4", type: "video/mp4", size: 100 }, "video").ok, true);
    assert.equal(validateAttachment({ name: "notes.md", type: "text/markdown", size: 40 }, "files").ok, true);
    assert.equal(validateAttachment({ name: "x.bin", type: "application/octet-stream", size: 40 }, "files").ok, false);
    assert.equal(validateAttachment({ name: "big.jpg", type: "image/jpeg", size: 9_000_000 }, "photo").ok, false);
  });

  it("frame gate drops extras while one send is in flight", () => {
    const g = createFrameGate();
    assert.equal(beginFrame(g), true);
    assert.equal(beginFrame(g), false);
    assert.equal(g.dropped, 1);
    endFrame(g);
    assert.equal(beginFrame(g), true);
  });

  it("documents that realtime native input_image is unsupported", () => {
    assert.equal(REALTIME_NATIVE_INPUT_IMAGE, false);
  });
});
