import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPostfxViewportRebind, postfxViewport } from "./viewport-rebind.ts";

/**
 * Light c108 hacker pass: drawing-buffer edge vs GPU max texture size.
 * Repro: 7680×2160 CSS (window spanning two 4K panels) at DPR 2 asked the
 * composer for a 13440-px-wide target — larger than an 8192 maxTextureSize GPU
 * can allocate (incomplete FBO, black frame, no error).
 */
describe("postfx buffer edge clamp (hacker c108)", () => {
  it("repro: without a GPU limit the buffer exceeds 8192 (documents the old behaviour)", () => {
    const vp = postfxViewport(7680, 2160, 2);
    assert.equal(vp.bufW, 13440);
  });

  it("with maxEdge both buffer edges fit and DPR is lowered to match", () => {
    const vp = postfxViewport(7680, 2160, 2, undefined, 8192);
    assert.ok(vp.bufW <= 8192 && vp.bufH <= 8192, JSON.stringify(vp));
    assert.ok(vp.dpr < 1.75 && vp.dpr > 1);
    assert.equal(vp.bufW, Math.round(7680 * vp.dpr));
  });

  it("normal screens are untouched; junk maxEdge is ignored", () => {
    assert.deepEqual(postfxViewport(1920, 1080, 2, undefined, 16384), postfxViewport(1920, 1080, 2));
    for (const junk of [Number.NaN, 0, -1, 0.5, Infinity]) {
      assert.equal(postfxViewport(7680, 2160, 2, undefined, junk).bufW, 13440, String(junk));
    }
  });

  it("gap #66: a WebGL1 GPU reporting maxTextureSize 1024 still clamps the buffer", () => {
    const vp = postfxViewport(1920, 1080, 2, undefined, 1024);
    assert.ok(vp.bufW <= 1024 && vp.bufH <= 1024, JSON.stringify(vp));
    assert.equal(vp.bufW, 1024);
    assert.ok(vp.dpr <= 1024 / 1920 + 1e-9);
    const small = postfxViewport(800, 600, 1, undefined, 512);
    assert.ok(small.bufW <= 512 && small.bufH <= 512, JSON.stringify(small));
  });

  it("gap #66: rebind honors capabilities.maxTextureSize 1024", () => {
    const rb = createPostfxViewportRebind(() => ({
      renderer: { setPixelRatio: () => {}, setSize: () => {}, capabilities: { maxTextureSize: 1024 } },
      composer: { setPixelRatio: () => {}, setSize: () => {}, readBuffer: { depthTexture: null } },
    }));
    const r = rb.resize(1920, 1080, 2)!;
    assert.ok(r.viewport.bufW <= 1024 && r.viewport.bufH <= 1024, JSON.stringify(r.viewport));
  });

  it("extreme CSS width can drop below POSTFX_MIN_DPR so the FBO stays valid", () => {
    const vp = postfxViewport(40000, 500, 0.25, undefined, 4096);
    assert.ok(vp.bufW <= 4096 && vp.bufH >= 1);
  });

  it("rebind reads renderer.capabilities.maxTextureSize and feeds god-ray buffer size", () => {
    const sizes: Array<[number, number]> = [];
    const godBuf: Array<[number, number]> = [];
    const rb = createPostfxViewportRebind(() => ({
      renderer: {
        setPixelRatio: () => {},
        setSize: (w, h) => sizes.push([w, h]),
        capabilities: { maxTextureSize: 8192 },
      },
      composer: { setPixelRatio: () => {}, setSize: () => {}, readBuffer: { depthTexture: null } },
      godRays: { setDepthTexture: () => {}, setBufferSize: (w, h) => (godBuf.push([w, h]), 32) },
    }));
    const r = rb.resize(7680, 2160, 2)!;
    assert.ok(r.viewport.bufW <= 8192);
    assert.deepEqual(godBuf.at(-1), [r.viewport.bufW, r.viewport.bufH]);
    assert.deepEqual(r.errors, []);
  });
});
