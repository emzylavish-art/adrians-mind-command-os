import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCameraMirrorTransform, nextLightboxZoom, prevLightboxZoom } from "./media-ui-helpers.ts";

describe("lightbox zoom steps", () => {
  it("cycles forward through 100% → 150% → 200% → 300% → 100%", () => {
    assert.equal(nextLightboxZoom(1), 1.5);
    assert.equal(nextLightboxZoom(1.5), 2);
    assert.equal(nextLightboxZoom(2), 3);
    assert.equal(nextLightboxZoom(3), 1);
  });

  it("cycles backward and tolerates unknown current values", () => {
    assert.equal(prevLightboxZoom(1), 3);
    assert.equal(prevLightboxZoom(1.5), 1);
    assert.equal(prevLightboxZoom(2), 1.5);
    assert.equal(prevLightboxZoom(3), 2);
    assert.equal(nextLightboxZoom(9), 1);
    assert.equal(prevLightboxZoom(9), 1);
  });
});

describe("camera mirror transform", () => {
  it("mirrors horizontally when enabled and is a no-op when disabled", () => {
    const calls: Array<{ op: string; args: number[] }> = [];
    const ctx = {
      translate: (x: number, y: number) => calls.push({ op: "translate", args: [x, y] }),
      scale: (x: number, y: number) => calls.push({ op: "scale", args: [x, y] }),
    };
    applyCameraMirrorTransform(ctx, 640, false);
    assert.deepEqual(calls, []);
    applyCameraMirrorTransform(ctx, 640, true);
    assert.deepEqual(calls, [
      { op: "translate", args: [640, 0] },
      { op: "scale", args: [-1, 1] },
    ]);
  });
});
