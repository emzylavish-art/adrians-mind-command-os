import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  BLOOM_MIP0_CAP_PIXELS,
  bloomChainModel,
  bloomScaleFor,
  blurKernel,
  discGlow,
  edgeGlow,
  glowReach,
  type BloomMipMeasure,
} from "./bloom-budget.ts";
import { BLOOM_BY_TONE, createTunedBloomPass, safeBloomSize } from "./bloom-tuning.ts";

/**
 * Light #110 — bloom chain resolution budget. Footprint is MEASURED from the
 * pass's real render-target sizes + blur-material uniforms (not constants),
 * then convolved with an Imagine-node disc and a chart-plate edge.
 */
type PassLike = {
  renderTargetsHorizontal: THREE.WebGLRenderTarget[];
  separableBlurMaterials: THREE.ShaderMaterial[];
};
function measure(pass: unknown): BloomMipMeasure[] {
  const p = pass as PassLike;
  return p.separableBlurMaterials.map((m, i) => ({
    rtW: p.renderTargetsHorizontal[i].width,
    kernel: {
      centerWeight: m.uniforms.centerWeight.value as number,
      offsets: [...(m.uniforms.gaussianOffsets.value as number[])],
      weights: [...(m.uniforms.gaussianWeights.value as number[])],
    },
  }));
}
const mip0 = (pass: unknown) => {
  const rt = (pass as PassLike).renderTargetsHorizontal[0];
  return [rt.width, rt.height] as const;
};

/** Stock three pass at full device size = the look we must preserve. */
function nativePass(bufW: number, bufH: number) {
  const t = BLOOM_BY_TONE.healthy;
  return new UnrealBloomPass(new THREE.Vector2(bufW, bufH), t.strength, t.radius, t.threshold);
}

const LEVEL = 1 / 255; // first visible 8-bit step of added glow
const DPR = 1.75;
const NODE_R = 22 * DPR; // Imagine node disc radius (~22 CSS px) in buffer px
const BUFS: Array<[string, number, number]> = [
  ["1440p@1.75 (11.3 MP)", 4480, 2520],
  ["4K@1 (8.3 MP)", 3840, 2160],
  ["MBP16@1.75 (5.9 MP)", 3024, 1955],
];

function footprint(pass: unknown, bufW: number) {
  const t = BLOOM_BY_TONE.healthy;
  const m = bloomChainModel(bufW, measure(pass), t.strength, t.radius);
  return {
    nodeReach: glowReach((d) => discGlow(m, NODE_R, NODE_R + d), LEVEL, 2000),
    nodeRim: discGlow(m, NODE_R, NODE_R + 4),
    plateReach: glowReach((d) => edgeGlow(m, d), LEVEL, 2000),
    plateMid: edgeGlow(m, 24 * DPR),
  };
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("light #110 bloom resolution budget", () => {
  it("caps mip-0 at ≤1.25 MP above 2.5 MP buffers; leaves ≤2.5 MP (1080p) native", () => {
    for (const [, w, h] of BUFS) {
      const b = createTunedBloomPass(new THREE.Vector2(w, h), "healthy");
      const [mw, mh] = mip0(b.pass);
      assert.ok(mw * mh <= BLOOM_MIP0_CAP_PIXELS * 1.01, `${w}x${h} mip0 ${mw}x${mh}`);
      b.dispose();
    }
    const fhd = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    assert.deepEqual(mip0(fhd.pass), [960, 540]);
    assert.equal(fhd.chainScale, 1);
    fhd.dispose();
    assert.equal(bloomScaleFor(1920, 1080, 4), 1, "frame tier never shrinks ≤2.5 MP");
  });

  it("composer-driven pass.setSize (device px) also gets the budget", () => {
    const b = createTunedBloomPass(new THREE.Vector2(64, 64), "healthy");
    b.pass.setSize(4480, 2520);
    const [mw, mh] = mip0(b.pass);
    assert.ok(mw * mh <= BLOOM_MIP0_CAP_PIXELS * 1.01);
    assert.ok(Math.abs(mw / mh - 4480 / 2520) < 0.01, "aspect kept");
    b.dispose();
  });

  for (const [label, w, h] of BUFS) {
    it(`${label}: node + chart-plate glow footprint matches the native chain`, () => {
      const nat = nativePass(w, h);
      const ref = footprint(nat, w);
      const b = createTunedBloomPass(new THREE.Vector2(w, h), "healthy");
      assert.ok(b.chainScale < 1, "budget active");
      const got = footprint(b.pass, w);
      for (const k of Object.keys(ref) as Array<keyof typeof ref>) {
        assert.ok(rel(got[k], ref[k]) < 0.03, `${k}: native ${ref[k].toFixed(4)} budget ${got[k].toFixed(4)}`);
      }
      // Control: same reduced chain with stock kernels (no compensation) is visibly wider.
      const [bw, bh] = safeBloomSize(w * b.chainScale, h * b.chainScale);
      const naive = nativePass(bw, bh);
      const bad = footprint(naive, w);
      const widen = 1 + 0.5 * (1 / b.chainScale - 1);
      assert.ok(bad.plateReach > ref.plateReach * widen, `uncompensated plate reach ${bad.plateReach} vs ${ref.plateReach}`);
      // Fill saved: bright + 10 blur targets ∝ mip-0 area.
      const [nw, nh] = mip0(nat);
      const [cw, ch] = mip0(b.pass);
      assert.ok(cw * ch < nw * nh, "fewer bloom pixels");
      nat.dispose();
      naive.dispose();
      b.dispose();
    });
  }

  it("1080p kernels are untouched (bit-identical to stock)", () => {
    const b = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    measure(b.pass).forEach((m, i) => {
      const stock = blurKernel([6, 10, 14, 18, 22][i]);
      assert.equal(m.kernel.centerWeight, stock.centerWeight);
      assert.deepEqual(m.kernel.weights, stock.weights);
    });
    b.dispose();
  });

  it("shares the #109 frame-time tier: sustained slow frames lower the cap, fast frames restore it", () => {
    const b = createTunedBloomPass(new THREE.Vector2(3024, 1955), "healthy", {
      frameOpts: { slowHold: 5, fastHold: 10, alpha: 1 },
    });
    const s0 = b.chainScale;
    for (let i = 0; i < 6; i++) b.sampleFrame(30);
    assert.ok(b.frameTier >= 1);
    assert.ok(b.chainScale < s0, `slow tier shrinks: ${b.chainScale} < ${s0}`);
    // Footprint still compensated at the lower tier.
    const nat = nativePass(3024, 1955);
    const ref = footprint(nat, 3024);
    const got = footprint(b.pass, 3024);
    assert.ok(rel(got.nodeReach, ref.nodeReach) < 0.04, `tier reach ${got.nodeReach} vs ${ref.nodeReach}`);
    for (let i = 0; i < 400; i++) b.sampleFrame(10);
    assert.equal(b.frameTier, 0);
    assert.equal(b.chainScale, s0);
    // Junk / hidden-tab deltas are ignored.
    b.sampleFrame(Number.NaN);
    b.sampleFrame(5000);
    assert.equal(b.frameTier, 0);
    nat.dispose();
    b.dispose();
  });

  it("budget: false keeps the stock chain", () => {
    const b = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy", { budget: false });
    assert.deepEqual(mip0(b.pass), [2048, 1152 /* 4096-edge clamp, aspect kept */]);
    b.dispose();
  });
});
