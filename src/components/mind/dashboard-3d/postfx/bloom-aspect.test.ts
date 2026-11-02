import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { BLOOM_MAX_EDGE, createTunedBloomPass, safeBloomSize } from "./bloom-tuning.ts";

/**
 * HACKER (light c110): safeBloomSize clamped each edge independently, so a
 * buffer wider than BLOOM_MAX_EDGE (5120×1440 super-ultrawide @1, 2560×1440
 * @1.75 = 4480) got a squashed bloom chain: non-square texels → horizontally
 * stretched halos around every node.
 */
describe("bloom edge clamp keeps aspect (hacker c110)", () => {
  for (const [w, h] of [
    [5120, 1440],
    [4480, 2520],
    [13440, 3780],
  ]) {
    it(`${w}x${h}`, () => {
      const [cw, ch] = safeBloomSize(w, h);
      assert.ok(cw <= BLOOM_MAX_EDGE && ch <= BLOOM_MAX_EDGE);
      assert.ok(Math.abs(cw / ch - w / h) / (w / h) < 0.005, `aspect ${cw}/${ch} vs ${w}/${h}`);
      const b = createTunedBloomPass(new THREE.Vector2(64, 64), "idle", { budget: false });
      b.pass.setSize(w, h);
      const rt = (b.pass as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[] }).renderTargetsHorizontal[0];
      // Texel aspect (buffer px per texel, x vs y) must be ~1 → round halos.
      const tx = w / (rt.width * 2);
      const ty = h / (rt.height * 2);
      assert.ok(Math.abs(tx / ty - 1) < 0.01, `texel aspect ${(tx / ty).toFixed(3)}`);
      b.dispose();
    });
  }
});
