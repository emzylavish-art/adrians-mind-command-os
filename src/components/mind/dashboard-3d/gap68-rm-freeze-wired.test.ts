import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("Gap#68 reduced-motion freeze (c70)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "universe-scene.tsx"), "utf8");

  it("5s skip path does not soft-sync comets under unchanged RM hash", () => {
    const idx = src.indexOf("if (!shouldRebuildScene(rmGuard, dataHash, reducedMotion, now))");
    assert.ok(idx > 0);
    const end = src.indexOf("} else if (nextSig !== lastSceneSyncSig)", idx);
    assert.ok(end > idx);
    const slice = src.slice(idx, end);
    const code = slice.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /syncCommitComets\s*\(/);
    assert.match(slice, /Gap#68/);
  });

  it("alias soft-sync is gated off under reducedMotion", () => {
    assert.match(src, /else if \(comets && !reducedMotion\)/);
  });

  it("comet setCamDistance skipped under reducedMotion", () => {
    const idx = src.indexOf("Motion c31 optional");
    assert.ok(idx > 0);
    const slice = src.slice(idx, idx + 500);
    assert.match(slice, /if \(!reducedMotion\)/);
    assert.match(slice, /setCamDistance/);
  });

  it("CSS2D labelRenderer reprojects only when camera moved under RM", () => {
    assert.match(src, /lastLabelCamX/);
    assert.match(src, /CSS2D subpixel jitter/);
    assert.match(src, /labelRenderer\.render\(scene, camera\)/);
  });
});
