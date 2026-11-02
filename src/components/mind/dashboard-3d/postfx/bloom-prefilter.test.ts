import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { applyPrefilter, prefilterTaps, PREFILTER_HIGHPASS_FRAGMENT } from "./bloom-prefilter.ts";
import { createTunedBloomPass } from "./bloom-tuning.ts";
import { createFocusBloomGuard, FocusBloomGuardShader } from "./focus-bloom-guard.ts";

/**
 * #112 model: 1-D CPU mirror of the bright pass (bilinear taps + the real
 * smoothstep threshold) sampling a 2-px highlight that slides across the
 * buffer in 0.1-px steps — i.e. a node specular / comet head while orbiting.
 * Flicker = (max − min) / mean of the bright-target energy over the sweep.
 */
const THRESH = 0.24; // BLOOM_BY_TONE.healthy.threshold
const SMOOTH = 0.01; // UnrealBloomPass smoothWidth

function source(W: number, p: number, width = 2, level = 0.9): Float64Array {
  const s = new Float64Array(W);
  for (let k = 0; k < W; k++) {
    const cover = Math.max(0, Math.min(k + 1, p + width) - Math.max(k, p));
    s[k] = cover * level;
  }
  return s;
}
const bilinear = (s: Float64Array, x: number) => {
  const t = x - 0.5;
  const k0 = Math.floor(t);
  const f = t - k0;
  const at = (k: number) => s[Math.max(0, Math.min(s.length - 1, k))];
  return at(k0) * (1 - f) + at(k0 + 1) * f;
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const tap = (s: Float64Array, x: number) => {
  const v = bilinear(s, x);
  return v * smoothstep(THRESH, THRESH + SMOOTH, v);
};
function brightEnergy(s: Float64Array, brightW: number, prefilter: boolean): number {
  const f = s.length / brightW;
  const layout = prefilter ? prefilterTaps(f) : { n: 1, offsets: [0] };
  let e = 0;
  for (let i = 0; i < brightW; i++) {
    const c = (i + 0.5) * f;
    let acc = 0;
    for (const o of layout.offsets) acc += tap(s, c + o);
    e += (acc / layout.offsets.length) * f; // each bright texel stands for f source texels
  }
  return e;
}
function flicker(W: number, brightW: number, prefilter: boolean) {
  const es: number[] = [];
  for (let p = 40; p < 40 + 2 * (W / brightW); p += 0.1) es.push(brightEnergy(source(W, p), brightW, prefilter));
  const mean = es.reduce((a, b) => a + b, 0) / es.length;
  return { flicker: (Math.max(...es) - Math.min(...es)) / mean, mean };
}

describe("#112 bloom bright-pass prefilter (light c111)", () => {
  const W = 480; // a 480-texel slice is enough; ratios are what matter

  it("native chain (footprint 2) is stock: single tap; threshold-edge baseline only", () => {
    assert.deepEqual(prefilterTaps(2), { n: 1, offsets: [0] });
    const nat = flicker(W, W / 2, true);
    // Bilinear edge texels dip under the 0.24 threshold: that 0.27 swing is the native look.
    assert.ok(nat.flicker < 0.3, `native flicker ${nat.flicker}`);
  });

  it("repro: #110 4480×2520 budget (bright footprint ≈3) single tap shimmers a 2-px highlight", () => {
    const stock = flicker(W, W / 3, false);
    assert.ok(stock.flicker > 1.4, `stock flicker ${stock.flicker}`);
  });

  it("prefilter at footprint 3 cuts shimmer ≥ 5× (below native) and keeps energy within 6%", () => {
    const nat = flicker(W, W / 2, true);
    const stock = flicker(W, W / 3, false);
    const pre = flicker(W, W / 3, true);
    assert.equal(prefilterTaps(3).n, 3);
    assert.ok(pre.flicker * 5 <= stock.flicker, `pre ${pre.flicker} vs stock ${stock.flicker}`);
    assert.ok(pre.flicker <= nat.flicker, `pre ${pre.flicker} vs native ${nat.flicker}`);
    assert.ok(Math.abs(pre.mean / nat.mean - 1) < 0.06, `energy ${pre.mean} vs native ${nat.mean}`);
  });

  it("across #109 backoff footprints (2.5–9.5) the prefilter cuts shimmer ≥ 4× with ≤ 16 taps", () => {
    const nat = flicker(W, W / 2, true);
    for (const f of [2.5, 3.5, 4, 4.5, 5, 6, 8, 9.5]) {
      const bw = Math.round(W / f);
      const pre = flicker(W, bw, true);
      const stock = flicker(W, bw, false);
      assert.ok(prefilterTaps(f).n <= 4);
      assert.ok(pre.flicker * 4 <= stock.flicker, `f=${f} pre ${pre.flicker} stock ${stock.flicker}`);
      assert.ok(Math.abs(pre.mean / nat.mean - 1) < 0.06, `f=${f} energy ${pre.mean}`);
    }
  });

  it("junk sizes fall back to the stock single tap", () => {
    for (const [sw, bw] of [[Number.NaN, 10], [0, 0], [100, Infinity], [-5, 3]] as const) {
      assert.equal(applyPrefilter(null, sw, 100, bw, 50).n, 1, `${sw}/${bw}`);
    }
  });

  it("tuned bloom swaps in the prefilter fragment and sets live uniforms from render sizes", () => {
    const h = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy");
    assert.equal(h.pass.materialHighPassFilter.fragmentShader, PREFILTER_HIGHPASS_FRAGMENT);
    assert.equal(h.pass.materialHighPassFilter.uniforms, h.pass.highPassUniforms);
    assert.ok(h.chainScale < 1);
    const u = h.pass.highPassUniforms as unknown as Record<string, { value: any }>;
    const st = applyPrefilter(u, 4480, 2520, h.pass.renderTargetBright.width, h.pass.renderTargetBright.height);
    assert.equal(st.n, 3, JSON.stringify(st));
    assert.equal(u.uPrefilterTaps.value, st.n);
    assert.ok(Math.abs(u.uSrcTexel.value.x - 1 / 4480) < 1e-12);
    h.dispose();
  });

  it("1080p (no budget downscale) resolves to the stock single tap", () => {
    const h = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    const b = h.pass.renderTargetBright;
    assert.equal(applyPrefilter(null, 1920, 1080, b.width, b.height).n, 1);
    h.dispose();
  });

  it("prefilter off / budget off keeps the stock three fragment", () => {
    const a = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy", { prefilter: false });
    const b = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy", { budget: false });
    assert.notEqual(a.pass.materialHighPassFilter.fragmentShader, PREFILTER_HIGHPASS_FRAGMENT);
    assert.notEqual(b.pass.materialHighPassFilter.fragmentShader, PREFILTER_HIGHPASS_FRAGMENT);
    a.dispose();
    b.dispose();
  });

  it("focus bloom guard material carries the same prefilter", () => {
    assert.ok(FocusBloomGuardShader.fragmentShader.includes("lightBrightPass(vUv)"));
    assert.ok("uPrefilterTaps" in FocusBloomGuardShader.uniforms);
    const h = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy");
    const g = createFocusBloomGuard(h);
    g.dispose();
    h.dispose();
  });

  it("no GLSL reserved word 'half' in the prefilter chunk", () => {
    assert.ok(!/\bhalf\b/.test(PREFILTER_HIGHPASS_FRAGMENT));
  });
});
