import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeNotionPlainText } from "./notion-plain.ts";

describe("sanitizeNotionPlainText (Gap#44)", () => {
  it("strips tags, headings, and markdown colon escapes", () => {
    const raw =
      "## 2026-11-01T11:45\\:30+01\\:00 — <b>Key minted:</b> <code>mind-command-os-voice</code>";
    const out = sanitizeNotionPlainText(raw);
    assert.equal(out.includes("<"), false);
    assert.equal(out.includes("code>"), false);
    assert.equal(out.includes("\\:"), false);
    assert.match(out, /2026-11-01T11:45:30\+01:00/);
    assert.match(out, /Key minted/);
    assert.match(out, /mind-command-os-voice/);
  });

  it("returns empty for blank input", () => {
    assert.equal(sanitizeNotionPlainText(""), "");
    assert.equal(sanitizeNotionPlainText(null), "");
  });
});
