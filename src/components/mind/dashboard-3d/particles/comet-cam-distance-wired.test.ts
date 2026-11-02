import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("comet setCamDistance wiring (c67 / Motion c31)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../universe-scene.tsx"), "utf8");

  it("feeds camera.position.length into comets.setCamDistance before update", () => {
    assert.match(src, /comets\.setCamDistance\?\.\(camDist\)/);
    assert.match(src, /pauseWhenHidden:\s*true/);
  });
});
