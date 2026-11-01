import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHistoryMessages, stripAttachedStub, imagePayloadChars } from "./history.ts";

const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("history multimodal budget", () => {
  it("strips attach stubs", () => {
    assert.equal(stripAttachedStub("hello\n\n[Attached: a.png]"), "hello");
  });

  it("keeps the newest prior images within the budget", () => {
    const history = [
      { role: "user" as const, content: "one", images: [{ dataUrl: TINY, name: "a.png" }] },
      { role: "assistant" as const, content: "ok" },
      { role: "user" as const, content: "two", images: [{ dataUrl: TINY, name: "b.png" }] },
      { role: "assistant" as const, content: "ok2" },
      { role: "user" as const, content: "three", images: [{ dataUrl: TINY, name: "c.png" }] },
    ];
    const built = buildHistoryMessages(history, { maxImages: 2, maxImageChars: 10_000 });
    const withParts = built.filter((m) => Array.isArray(m.content));
    assert.equal(withParts.length, 2);
    // oldest dropped to string
    assert.equal(typeof built[0]?.content, "string");
  });

  it("counts image payload chars", () => {
    assert.equal(imagePayloadChars([{ dataUrl: "abc" }, { dataUrl: "de" }]), 5);
  });
});
