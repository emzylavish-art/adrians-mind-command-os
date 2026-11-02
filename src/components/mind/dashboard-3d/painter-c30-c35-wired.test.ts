import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("c72 — Motion c35 focus-flip + scene Imagine wash", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "universe-scene.tsx"), "utf8");

  it("traveler focused tracks landing.botId vs rig.subjectId before stepTravelerTrails", () => {
    assert.match(src, /land\.botId === focusId/);
    assert.match(src, /tr\.focused = Boolean\(focusId\)/);
    const idx = src.indexOf("Motion c21/c35");
    assert.ok(idx > 0);
    const slice = src.slice(idx, idx + 700);
    assert.match(slice, /stepTravelerTrails/);
  });

  it("scene art Imagine materials pass lane+health wash opts", () => {
    assert.match(src, /createImagineNodeMaterial\(\{\s*loading:\s*true,\s*lane:\s*"scene",\s*health:\s*"healthy"/);
  });
});
