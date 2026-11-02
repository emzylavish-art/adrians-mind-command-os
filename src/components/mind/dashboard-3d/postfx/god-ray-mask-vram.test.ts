import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  createGodRayMask,
  godRayMaskBytes,
  godRayMaskDecode,
  godRayMaskEncode,
  godRayMaskSize,
  godRayMaskType,
  godRayMaskUvScale,
} from "./god-ray-mask.ts";
import { createGodRayPass } from "./god-rays.ts";

/**
 * #117 hacker + VRAM: the #114 half-res emission mask must (a) never allocate a
 * HalfFloat FBO the GPU can't render to (silent black shafts), (b) never pin VRAM
 * while the pass is off, (c) stay pixel-aligned on odd drawing-buffer edges.
 */
type Caps = { webgl2: boolean; exts?: string[]; complete?: (type: number) => boolean };
const renderer = (caps: Caps, log: string[] = []) => {
  let bound: THREE.WebGLRenderTarget | null = null;
  return {
    capabilities: { isWebGL2: caps.webgl2 },
    extensions: { has: (n: string) => (caps.exts ?? []).includes(n) },
    getContext: () => ({
      FRAMEBUFFER: 0x8d40,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      checkFramebufferStatus: () =>
        !bound || !caps.complete || caps.complete(bound.texture.type) ? 0x8cd5 : 0x8cd6,
    }),
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      bound = t;
      log.push(t ? `rt:${t.texture.type}` : "screen");
    },
    render: () => log.push("draw"),
    clear: () => {},
    autoClear: true,
  } as unknown as THREE.WebGLRenderer;
};
const hdrSource = (w = 4480, h = 2520) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });

describe("#117 god-ray mask format, VRAM and alignment", () => {
  it("repro: WebGL2 without EXT_color_buffer_float must not get a HalfFloat mask", () => {
    assert.equal(godRayMaskType({ capabilities: { isWebGL2: true }, extensions: { has: () => false } }, THREE.HalfFloatType), THREE.UnsignedByteType);
    const m = createGodRayMask();
    const src = hdrSource();
    assert.ok(m.render(renderer({ webgl2: true }), src, 16));
    assert.equal(m.type, THREE.UnsignedByteType, "renderable byte mask, not a silently incomplete RGBA16F FBO");
    m.dispose();
    src.dispose();
  });

  it("HalfFloat mask when renderable (EXT_color_buffer_float or _half_float); byte on WebGL1 / byte source", () => {
    for (const ext of ["EXT_color_buffer_float", "EXT_color_buffer_half_float"]) {
      assert.equal(godRayMaskType({ capabilities: { isWebGL2: true }, extensions: { has: (n) => n === ext } }, THREE.HalfFloatType), THREE.HalfFloatType);
    }
    const all = { has: () => true };
    assert.equal(godRayMaskType({ capabilities: { isWebGL2: false }, extensions: all }, THREE.HalfFloatType), THREE.UnsignedByteType);
    // painter c20 half-float→byte composer fallback: LDR source, LDR mask (half the VRAM).
    assert.equal(godRayMaskType({ capabilities: { isWebGL2: true }, extensions: all }, THREE.UnsignedByteType), THREE.UnsignedByteType);
    assert.equal(godRayMaskType(null, THREE.HalfFloatType), THREE.UnsignedByteType);
    assert.equal(
      godRayMaskType({ capabilities: { isWebGL2: true }, extensions: { has: () => { throw new Error("lost"); } } }, THREE.HalfFloatType),
      THREE.UnsignedByteType,
    );
  });

  it("incomplete HalfFloat FBO falls back to byte; incomplete byte FBO falls back to the stock path (never samples black)", () => {
    const src = hdrSource();
    const m = createGodRayMask();
    const log: string[] = [];
    const r = renderer({ webgl2: true, exts: ["EXT_color_buffer_float"], complete: (t) => t !== THREE.HalfFloatType }, log);
    assert.ok(m.render(r, src, 16));
    assert.equal(m.type, THREE.UnsignedByteType);
    assert.equal(m.halfFloatRejected, true);
    assert.equal(log.filter((l) => l === "draw").length, 1, "drew once, into the complete byte target");
    assert.ok(m.render(r, src, 16), "sticky: no per-frame re-probe churn");
    m.dispose();
    const m2 = createGodRayMask();
    const dead = renderer({ webgl2: true, exts: ["EXT_color_buffer_float"], complete: () => false });
    assert.equal(m2.render(dead, src, 16), null);
    assert.equal(m2.target, null);
    assert.equal(m2.bytes, 0);
    assert.equal(m2.render(dead, src, 16), null, "stays on stock path");
    m2.dispose();
    src.dispose();
  });

  it("repro: mask VRAM is freed when the pass switches off (reduced motion / sun behind camera / no data)", () => {
    const g = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
    const r = renderer({ webgl2: true, exts: ["EXT_color_buffer_float"] });
    const src = hdrSource();
    const out = hdrSource();
    g.pass.render(r, out, src, 1 / 60, false);
    assert.equal(g.maskBytes, 2240 * 1260 * 8, "HalfFloat RGBA half-res mask");
    g.update({ healthy: 3, total: 4, reducedMotion: true });
    assert.equal(g.pass.enabled, false);
    assert.equal(g.maskBytes, 0, "disabled pass holds no mask VRAM");
    g.update({ healthy: 3, total: 4, reducedMotion: false });
    g.pass.render(r, out, src, 1 / 60, false);
    assert.ok(g.maskBytes > 0);
    const behind = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    behind.updateMatrixWorld();
    behind.updateProjectionMatrix();
    g.setSun(new THREE.Vector3(0, 0, 50), behind); // behind the camera
    assert.equal(g.pass.enabled, false);
    assert.equal(g.maskBytes, 0);
    g.dispose();
    src.dispose();
    out.dispose();
  });

  it("mask is freed on DPR drop to the 48-tap tier and on dispose (context-loss path)", () => {
    const g = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
    const r = renderer({ webgl2: true, exts: ["EXT_color_buffer_float"] });
    const big = hdrSource();
    g.pass.render(r, big, big, 1 / 60, false);
    assert.ok(g.maskBytes > 0);
    const hd = hdrSource(1920, 1080); // DPR 2 → 1
    g.pass.render(r, hd, hd, 1 / 60, false);
    assert.equal(g.maskBytes, 0);
    g.pass.render(r, big, big, 1 / 60, false);
    assert.ok(g.maskBytes > 0);
    g.dispose(); // context-loss.ts disposes godRays on webglcontextlost
    assert.equal(g.maskBytes, 0);
    for (const t of [big, hd]) t.dispose();
  });

  it("odd buffer edges: mask UV scale keeps 2×2 block centres on full-res texel centres", () => {
    assert.deepEqual(godRayMaskUvScale(4480, 2520, 2), [1, 1], "even edges bit-identical");
    const [sx, sy] = godRayMaskUvScale(2561, 1441, 2);
    const [mw, mh] = godRayMaskSize(2561, 1441, 2);
    for (const [s, m, W] of [[sx, mw, 2561], [sy, mh, 1441]] as const) {
      for (const i of [0, 1, (m >> 1), m - 2, m - 1]) {
        const vUv = (i + 0.5) / m;
        const centrePx = vUv * s * W; // should be exactly 2i + 1 (between texels 2i and 2i+1)
        assert.ok(Math.abs(centrePx - (2 * i + 1)) < 1e-6, `texel ${i}: ${centrePx}`);
        // Unscaled (the #114 code) drifts toward ~1 px at the far edge.
      }
      const drift = (((m - 0.5) / m) * W) - (2 * (m - 1) + 1);
      assert.ok(Math.abs(drift) > 0.49, "unscaled drift is real on odd edges");
    }
    assert.deepEqual(godRayMaskUvScale(0, 0, 2), [1, 1]);
    assert.deepEqual(godRayMaskUvScale(Number.NaN, 10, 2), [1, 1]);
  });

  it("radial read uses the inverse scale; byte sizes are honest", () => {
    const m = createGodRayMask();
    const src = hdrSource(2561, 1441);
    m.render(renderer({ webgl2: true, exts: ["EXT_color_buffer_float"] }), src, 16);
    const [sx, sy] = godRayMaskUvScale(2561, 1441, 2);
    assert.ok(Math.abs(m.readScale.x * sx - 1) < 1e-12 && Math.abs(m.readScale.y * sy - 1) < 1e-12);
    assert.equal(m.bytes, 1281 * 721 * 8);
    assert.equal(godRayMaskBytes(10, 10, THREE.UnsignedByteType), 400);
    assert.equal(godRayMaskBytes(10, 10, null), 0);
    m.dispose();
    src.dispose();
  });

  it("8-bit mask over an HDR source range-encodes (sun cores > 1 no longer clip); LDR / HalfFloat paths unchanged", () => {
    const q = (x: number) => Math.round(x * 255) / 255; // 8-bit storage
    for (const e of [0.05, 0.3, 0.98, 1.5, 3, 6]) {
      const back = godRayMaskDecode(q(godRayMaskEncode(e)));
      const clipped = Math.min(1, q(Math.min(1, e)));
      assert.ok(Math.abs(back - e) / e < 0.05, `encoded e=${e} → ${back.toFixed(3)}`);
      if (e > 1) assert.ok((e - clipped) / e > 0.3, "the old byte mask clipped this core");
    }
    // bilinear between an HDR core and black (decode(lerp) vs lerp): bounded bias
    let worst = 0;
    for (let t = 0; t <= 1; t += 0.125) {
      const truth = 3 * (1 - t);
      const got = godRayMaskDecode(q((1 - t) * godRayMaskEncode(3)));
      if (truth > 0.05) worst = Math.max(worst, Math.abs(got - truth) / 3);
    }
    assert.ok(worst < 0.55, `edge bias ${worst}`);
    const src = hdrSource();
    const ldr = new THREE.WebGLRenderTarget(4480, 2520); // painter c20 byte composer
    const r = renderer({ webgl2: false });
    const m = createGodRayMask();
    m.render(r, src, 16);
    assert.equal(m.type, THREE.UnsignedByteType);
    assert.equal(m.encoded, true, "WebGL1 byte mask over HDR source");
    m.render(r, ldr, 16);
    assert.equal(m.encoded, false, "LDR source: plain byte (no precision spent on range)");
    const h = createGodRayMask();
    h.render(renderer({ webgl2: true, exts: ["EXT_color_buffer_float"] }), src, 16);
    assert.equal(h.encoded, false, "HalfFloat mask stores linear emission");
    m.release();
    assert.equal(m.encoded, false);
    for (const x of [m, h]) x.dispose();
    src.dispose();
    ldr.dispose();
  });
});
