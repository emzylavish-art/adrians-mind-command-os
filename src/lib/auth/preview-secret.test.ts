import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { previewClientSecret } from "./preview.ts";

describe("preview OAuth secret is env-backed", () => {
  it("source does not hardcode a 64-char hex client secret", () => {
    const src = readFileSync(join(import.meta.dirname, "preview.ts"), "utf8");
    assert.doesNotMatch(src, /[0-9a-f]{64}/);
    assert.match(src, /GROK_PREVIEW_CLIENT_SECRET/);
    assert.match(src, /previewClientSecret/);
  });

  it("previewClientSecret reads process env", () => {
    const prev = process.env.GROK_PREVIEW_CLIENT_SECRET;
    process.env.GROK_PREVIEW_CLIENT_SECRET = "unit-test-preview-secret";
    try {
      assert.equal(previewClientSecret(), "unit-test-preview-secret");
    } finally {
      if (prev === undefined) delete process.env.GROK_PREVIEW_CLIENT_SECRET;
      else process.env.GROK_PREVIEW_CLIENT_SECRET = prev;
    }
  });
});
