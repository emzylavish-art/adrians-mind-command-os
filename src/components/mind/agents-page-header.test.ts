import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "agents-page-header.tsx"), "utf8");

describe("agents-page-header markup", () => {
  it("exposes stable class names and test ids for Visual Polish", () => {
    for (const token of [
      "agents-grok-header",
      "bots-shell-header",
      "agents-header-settings",
      "agents-header-search",
      "agents-header-new-bot",
      "agents-header-compose",
      "Coming soon",
    ]) {
      assert.ok(src.includes(token), `missing ${token}`);
    }
  });

  it("wires honest disabled states instead of toast stubs", () => {
    assert.equal(src.includes("markPreview"), false);
    assert.equal(src.includes("setNotice("), false);
    assert.ok(src.includes("aria-disabled"));
    assert.ok(src.includes("disabled={disabled}"));
  });
});
