import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("fleet beacon wire (c66 / Painter c27)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "fleet-plan-layer.ts"), "utf8");

  it("uses kit.createFleetBeacon instead of MeshStandard emissive LEDs", () => {
    assert.match(src, /createFleetBeacon/);
    assert.doesNotMatch(src, /MeshStandardMaterial/);
    assert.match(src, /rebuildQueueRoad\([^)]*kit/);
    assert.match(src, /rebuildLandingPaths\([^)]*kit/);
  });
});
