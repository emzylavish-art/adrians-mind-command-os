import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Hacker c64: universe-scene must not walk the comet group by name each frame
 * (Motion c24 applyCometLaunchSamples is the only apply path).
 */
describe("universe-scene comet apply wiring (c64 / queue #108)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../universe-scene.tsx"), "utf8");

  it("imports and calls applyCometLaunchSamples", () => {
    assert.match(src, /applyCometLaunchSamples/);
    assert.match(src, /applyCometLaunchSamples\(\s*comets,\s*cometLaunchSamples/);
  });

  it("does not getObjectByName motion-comet per frame", () => {
    assert.doesNotMatch(src, /getObjectByName\(`motion-comet-/);
    assert.doesNotMatch(src, /getObjectByName\(`motion-comet-head-/);
  });
});
