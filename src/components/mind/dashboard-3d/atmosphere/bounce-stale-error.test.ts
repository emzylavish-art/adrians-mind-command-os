import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createPortraitBounce, type PixelReader } from "./portrait-bounce.ts";

/**
 * HACKER (#68 cycle): `lastSampleError` was write-only-on-failure. After one
 * CORS-tainted portrait was focused, every later focus (good portrait, no
 * portrait, or the same cached-tainted one after a good one) kept reporting the
 * stale error — diagnostics claimed a failure while the light used real pixels,
 * and a cached failure never re-surfaced once overwritten. The error must
 * describe the CURRENT focus.
 */
const ready = { complete: true, naturalWidth: 64, naturalHeight: 64, width: 64, height: 64 };
function imgTex(img: object): THREE.Texture {
  const t = new THREE.Texture();
  t.image = img as never;
  return t;
}
const taintedImg = { ...ready, tag: "tainted" };
const goodImg = { ...ready, tag: "good" };
const reader: PixelReader = (image) => {
  if ((image as { tag?: string }).tag === "tainted") {
    const e = new Error("The canvas has been tainted by cross-origin data");
    e.name = "SecurityError";
    throw e;
  }
  const a = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) a.set([200, 80, 40, 255], i * 4);
  return a;
};
const at = { position: [0, 0, 0] as const, camera: [0, 0, 10] as const };

describe("portrait bounce: lastSampleError tracks the current focus (hacker #68)", () => {
  it("clears after a good portrait, re-surfaces for a cached tainted one, clears on no focus texture", () => {
    const scene = new THREE.Scene();
    const b = createPortraitBounce(scene, { reader });
    const bad = imgTex(taintedImg);
    const good = imgTex(goodImg);

    b.setFocus({ ...at, texture: bad });
    assert.equal(b.sampled, false);
    assert.match(b.lastSampleError ?? "", /SecurityError/);

    b.setFocus({ ...at, texture: good });
    assert.equal(b.sampled, true);
    assert.equal(b.lastSampleError, null, "good real sample must not report the old failure");

    b.setFocus({ ...at, texture: bad }); // cached failure, no new readback
    assert.equal(b.sampled, false);
    assert.match(b.lastSampleError ?? "", /SecurityError/, "cached failure re-surfaces");

    b.setFocus({ ...at, texture: null });
    assert.equal(b.lastSampleError, null);
    b.dispose();
  });
});
