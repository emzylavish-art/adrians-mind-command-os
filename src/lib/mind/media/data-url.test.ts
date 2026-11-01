import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitWithinBox, isImageDataUrl, normalizeImageDataUrl, parseImageDataUrl } from "./data-url.ts";
import { packageChatContent, packageMultimodalContent, sanitizeAttachments, historyTextForImages } from "./pack.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("image data-URL helpers", () => {
  it("accepts png/jpeg data URLs and rejects junk", () => {
    assert.equal(isImageDataUrl(TINY_PNG), true);
    assert.equal(isImageDataUrl("data:text/plain;base64,YQ=="), false);
    assert.equal(isImageDataUrl("https://example.com/a.png"), false);
    const parsed = parseImageDataUrl(TINY_PNG);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.mime, "image/png");
    assert.equal(normalizeImageDataUrl("not-an-image"), null);
  });

  it("fits large dimensions inside the max edge", () => {
    assert.deepEqual(fitWithinBox(4096, 2048, 2048), { width: 2048, height: 1024, scaled: true });
    assert.deepEqual(fitWithinBox(800, 600, 2048), { width: 800, height: 600, scaled: false });
  });
});

describe("multimodal packaging", () => {
  it("returns plain text when there are no images", () => {
    assert.equal(packageChatContent("hello", []), "hello");
  });

  it("builds OpenAI-compatible content parts with images", () => {
    const parts = packageMultimodalContent("what is this?", [{ dataUrl: TINY_PNG, name: "dot.png" }]);
    assert.equal(parts[0]?.type, "text");
    assert.equal(parts[1]?.type, "image_url");
    if (parts[1]?.type === "image_url") assert.equal(parts[1].image_url.url, TINY_PNG);
  });

  it("sanitizes bad attachments and caps count", () => {
    const many = Array.from({ length: 6 }, () => ({ dataUrl: TINY_PNG }));
    assert.equal(sanitizeAttachments(many).length, 4);
    assert.equal(sanitizeAttachments([{ dataUrl: "nope" }]).length, 0);
  });

  it("adds a history stub for attached images", () => {
    assert.match(historyTextForImages("hi", [{ dataUrl: TINY_PNG, name: "shot.png" }]), /Attached: shot\.png/);
  });
});
