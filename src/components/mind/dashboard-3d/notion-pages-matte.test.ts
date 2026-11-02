import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("Notion page galaxy (c71 Painter c30 adopt)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "universe-scene.tsx"), "utf8");

  it("rebuildPages uses kit.createNotionGalaxyPages (no MeshBasic/MeshStandard LEDs)", () => {
    const pagesIdx = src.indexOf("function rebuildPages");
    assert.ok(pagesIdx > 0);
    // Stop at end of rebuildPages body — do not include following Painter c9 comment.
    const close = src.indexOf("\n    }\n\n    // Painter c9", pagesIdx);
    assert.ok(close > pagesIdx, "rebuildPages terminator missing");
    const slice = src.slice(pagesIdx, close);
    assert.match(slice, /createNotionGalaxyPages/);
    assert.doesNotMatch(slice, /MeshBasicMaterial/);
    assert.doesNotMatch(slice, /MeshStandardMaterial/);
    assert.doesNotMatch(slice, /emissiveIntensity/);
  });

  it("dispose releases galaxyPages handle", () => {
    assert.match(src, /galaxyPages\?\.dispose/);
  });
});
