import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyGalleryName, listChatGalleryImages } from "./chat-gallery.ts";

const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("chat gallery", () => {
  it("skips missing image data and classifies the rest", () => {
    const items = listChatGalleryImages([
      { id: "m1", role: "user", images: [{ name: "camera-shot.png", dataUrl: pixel }, { blobId: "only-a-pointer" }] },
      { id: "m2", role: "assistant", images: [{ name: "generated-frame.png", dataUrl: pixel }] },
    ]);
    assert.deepEqual(items.map((item) => item.kind), ["camera", "generated"]);
    assert.equal(items.some((item) => item.src.startsWith("https:")), false);
  });

  it("does not call an ordinary attachment a camera or generated image", () => {
    assert.equal(classifyGalleryName("notes.png", "user"), "attached");
  });
});
