import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageDownloadName, listChatGalleryImages } from "./chat-gallery.ts";

const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("chat gallery", () => {
  it("skips missing image data and classifies the rest", () => {
    const items = listChatGalleryImages([
      { id: "m1", role: "user", images: [{ name: "renamed.png", origin: "camera", dataUrl: pixel }, { blobId: "only-a-pointer" }] },
      { id: "m2", role: "assistant", images: [{ name: "generated-frame.png", dataUrl: pixel }] },
    ]);
    assert.deepEqual(items.map((item) => item.kind), ["camera", "generated"]);
    assert.equal(items.some((item) => item.src.startsWith("https:")), false);
  });

  it("does not call an ordinary attachment a camera or generated image", () => {
    assert.equal(listChatGalleryImages([{ id: "upload", role: "user", images: [{ name: "edited-capture.gif", dataUrl: pixel }] }])[0].kind, "attached");
    assert.equal(imageDownloadName(pixel, "notes.gif"), "notes.gif");
  });
});
