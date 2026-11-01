import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { BLOOM_MAX_EDGE, createTunedBloomPass } from "./bloom-tuning.ts";

/**
 * Hacker pass (light cycle — high-DPR resize). EffectComposer.setSize(w,h) sizes
 * every pass at w*pixelRatio; universe-scene then calls bloomHandle.setSize(w,h)
 * with CSS pixels, which used to shrink bloom mips to 1/DPR² of the frame on
 * retina (soft, blocky halos after the first resize). Composer-driven sizes also
 * bypassed the NaN/0/huge clamp.
 */
const mip0 = (b: ReturnType<typeof createTunedBloomPass>) => {
  const rt = (b.pass as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[] })
    .renderTargetsHorizontal[0];
  return [rt.width, rt.height];
};

describe("bloom high-DPR resize (hacker cycle)", () => {
  it("handle.setSize(css) after composer sizing at css*dpr keeps device-pixel bloom", () => {
    const b = createTunedBloomPass(new THREE.Vector2(800, 600), "idle");
    // EffectComposer.setSize(1200, 800) with pixelRatio 1.75
    b.pass.setSize(1200 * 1.75, 800 * 1.75);
    b.setSize(1200, 800);
    assert.deepEqual(mip0(b), [1050, 700], "bloom must stay at device pixels/2, not css/2");
    b.dispose();
  });

  it("explicit pixelRatio sizes in device pixels", () => {
    const b = createTunedBloomPass(new THREE.Vector2(64, 64), "idle");
    b.setSize(1000, 500, 2);
    assert.deepEqual(mip0(b), [1000, 500]);
    b.dispose();
  });

  it("composer-driven pass.setSize is clamped (NaN / 0 / 8K×3)", () => {
    const b = createTunedBloomPass(new THREE.Vector2(64, 64), "idle");
    b.pass.setSize(Number.NaN, 0);
    for (const v of mip0(b)) assert.ok(Number.isFinite(v) && v >= 1, `mip edge ${v}`);
    b.pass.setSize(7680 * 3, 4320 * 3);
    for (const v of mip0(b)) assert.ok(v <= BLOOM_MAX_EDGE / 2, `mip edge ${v}`);
    b.dispose();
  });
});
