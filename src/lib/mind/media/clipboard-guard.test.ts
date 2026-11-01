import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSafeImageSrcFromHtml, sanitizeComposerPasteText, sanitizePastedImageCandidate } from "./clipboard-guard.ts";

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
