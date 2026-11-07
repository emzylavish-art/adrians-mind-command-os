import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../components/mind/command-app.tsx"), "utf8");

/** 390px is inside the max-width: 767.98px rule shipped in e9f00aa. */
const NARROW_PX = 390;
const MEDIA_MAX_PX = 767.98;

function zIndex(selector: string): number {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*z-index:\\s*(\\d+)\\s*!important");
  const match = app.match(re);
  assert.ok(match, `missing z-index for ${selector}`);
  return Number(match?.[1]);
}

describe("390px Speak stacking", () => {
  it("places the Speak control above nav[aria-label=Primary]", () => {
    assert.ok(NARROW_PX < MEDIA_MAX_PX);
    assert.match(app, /@media \(max-width: 767\.98px\)/);
    assert.match(app, /aria-label="Primary"/);
    const nav = zIndex('nav.fixed.inset-x-0.bottom-0[aria-label="Primary"]');
    const speak = zIndex(".shell .live-voice-compact-entry");
    assert.equal(nav, 30);
    assert.equal(speak, 60);
    assert.ok(speak > nav);
    assert.match(app, /\.shell \.live-voice-compact-entry \{ z-index: 60 !important; bottom: calc\(4\.75rem \+ env\(safe-area-inset-bottom, 0px\)\) !important; \}/);
  });
});
