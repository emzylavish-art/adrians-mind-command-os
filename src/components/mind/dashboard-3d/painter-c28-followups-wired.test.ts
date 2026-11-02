import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("Painter c28 Still-unwired follow-ups (c69)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "universe-scene.tsx"), "utf8");

  it("composer uses resolvePainterlyRenderTargetType + half-float probe", () => {
    assert.match(src, /resolvePainterlyRenderTargetType/);
    assert.match(src, /probeHalfFloatRenderTargetSupport/);
  });

  it("lore plaques call setLorePlaqueLockAge + setLorePlaqueStackIndex", () => {
    assert.match(src, /setLorePlaqueLockAge/);
    assert.match(src, /setLorePlaqueStackIndex/);
  });

  it("landing travelers use createFleetBeacon (no MeshStandard traveler LEDs)", () => {
    assert.match(src, /createFleetBeacon\(\{\s*color:\s*0xffe08a/);
    const idx = src.indexOf("landing-trail travelers");
    assert.ok(idx > 0);
    const slice = src.slice(idx, idx + 1600);
    assert.doesNotMatch(slice, /MeshStandardMaterial/);
  });

  it("traveler trails enable Motion c33 point budget with camDistance", () => {
    assert.match(src, /enablePointBudget:\s*true/);
    assert.match(src, /camDistance:\s*camera\.position\.length\(\)/);
  });

  it("debug meter badge surfaces painter budgetMeta.degraded", () => {
    assert.match(src, /painter:degraded/);
    assert.match(src, /kit\.budgetMeta\?\.degraded/);
  });
});
