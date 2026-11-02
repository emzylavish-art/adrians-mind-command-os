import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("Notion page galaxy material (c68 hacker)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "universe-scene.tsx"), "utf8");

  it("rebuildPages uses MeshBasicMaterial (no MeshStandard emissive LEDs)", () => {
    // The InstancedMesh page galaxy block should not create MeshStandardMaterial.
    const pagesIdx = src.indexOf("function rebuildPages");
    assert.ok(pagesIdx > 0);
    const slice = src.slice(pagesIdx, pagesIdx + 1800);
    assert.match(slice, /MeshBasicMaterial/);
    assert.doesNotMatch(slice, /MeshStandardMaterial/);
    assert.doesNotMatch(slice, /emissiveIntensity/);
  });
});
