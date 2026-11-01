import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectClipboardImageFiles, extractSafeImageSrcFromHtml, sanitizeComposerPasteText, sanitizePastedImageCandidate } from "./clipboard-guard.ts";

describe("adversarial: clipboard image / HTML paste", () => {
  it("rejects javascript: and data:text/html candidates", () => {
    assert.equal(sanitizePastedImageCandidate("javascript:alert(1)"), null);
    assert.equal(sanitizePastedImageCandidate("data:text/html;base64,PHNjcmlwdD4="), null);
    assert.equal(sanitizePastedImageCandidate("https://cdn.example/a.png"), "https://cdn.example/a.png");
  });

  it("strips HTML and blocks scripty img srcs", () => {
    assert.equal(extractSafeImageSrcFromHtml('<img src="javascript:alert(1)">'), null);
    assert.equal(extractSafeImageSrcFromHtml('<img src="https://cdn.example/a.png">'), "https://cdn.example/a.png");
    assert.equal(sanitizeComposerPasteText('<b>hi</b> javascript:alert(1)').includes("javascript:"), false);
  });
});

describe("adversarial: clipboard image/* file paste", () => {
  it("collects image files and skips svg / non-images", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const svg = new File(["<svg>"], "x.svg", { type: "image/svg+xml" });
    const txt = new File(["hi"], "a.txt", { type: "text/plain" });
    const files = collectClipboardImageFiles({
      items: [
        { type: "image/png", getAsFile: () => png },
        { type: "image/svg+xml", getAsFile: () => svg },
      ],
      files: [txt, png],
    });
    assert.equal(files.length, 1);
    assert.equal(files[0]?.name, "a.png");
  });
});
