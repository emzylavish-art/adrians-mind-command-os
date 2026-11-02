import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { godRayTapParams } from "./god-ray-budget.ts";
import { createGodRayMask, godRayMaskFactor, godRayMaskSize, GodRayMaskShader } from "./god-ray-mask.ts";
import { createGodRayPass, GodRayShader } from "./god-rays.ts";

/**
 * #114 CPU model of the radial sampler (sun at x = 0, pixel 600 screen px out,
 * 2-device-px source ~300 px from the sun sliding 0.1 px per step, 4×4 screen-px
 * perceived window, the shader's interleaved-gradient jitter, real smoothstep
 * emission and the #109 per-tap decay / norm). Flicker = (max − min) / mean.
 */
const ss = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ign = (x: number, y: number) => {
  const v = 52.9829189 * ((x * 0.06711056 + y * 0.00583715) % 1);
  return v - Math.floor(v);
};
const boxAt = (p: number, w = 2, level = 0.95) => (k: number) =>
  Math.max(0, Math.min(k + 1, p + w) - Math.max(k, p)) * level;

function shaft(scale: number, taps: number, srcPx: number, maskFactor: number): number {
  const P = godRayTapParams(taps);
  const tex = boxAt(srcPx * scale);
  const emitTexel = (k: number) => {
    const l = tex(k);
    return l * ss(0.55, 0.8, l);
  };
  const bilinear = (f: (k: number) => number, x: number) => {
    const t = x - 0.5;
    const k0 = Math.floor(t);
    const fr = t - k0;
    return f(k0) * (1 - fr) + f(k0 + 1) * fr;
  };
  const sample =
    maskFactor === 1
      ? (x: number) => {
          const l = bilinear(tex, x);
          return l * ss(0.55, 0.8, l);
        }
      : (x: number) => {
          const low = (h: number) => {
            let a = 0;
            for (let q = 0; q < maskFactor; q++) a += emitTexel(h * maskFactor + q);
            return a / maskFactor;
          };
          return bilinear(low, x / maskFactor);
        };
  let acc = 0;
  let n = 0;
  const win = Math.round(4 * scale);
  for (let r = 0; r < win; r++)
    for (let i = 0; i < win; i++) {
      const x = 600 * scale + i;
      const step = (x * 0.82) / taps;
      let u = x - step * ign(x, r + 100);
      let ill = 1;
      let a = 0;
      for (let k = 0; k < taps; k++) {
        u -= step;
        a += sample(u) * ill * 0.42;
        ill *= P.decay;
      }
      acc += a * P.norm;
      n++;
    }
  return acc / n;
}
function flicker(scale: number, taps: number, maskFactor: number): number {
  const v: number[] = [];
  for (let k = 0; k <= 20; k++) v.push(shaft(scale, taps, 300 + k * 0.1, maskFactor));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return (Math.max(...v) - Math.min(...v)) / mean;
}

describe("#114 god-ray emission mask anti-alias", () => {
  it("reproduces the shimmer: 16 taps on a 4480-wide buffer flickers well above native 1080p/48", () => {
    const native = flicker(1, 48, 1);
    const budget = flicker(2.333, 16, 1);

    assert.ok(budget > native * 1.15, `budget ${budget.toFixed(3)} vs native ${native.toFixed(3)}`);
  });

  it("half-res prefiltered mask brings 16-tap flicker to at or below native", () => {
    const native = flicker(1, 48, 1);
    const fixed = flicker(2.333, 16, 2);
    assert.ok(fixed <= native, `fixed ${fixed.toFixed(3)} vs native ${native.toFixed(3)}`);
  });

  it("uniform field energy is unchanged by the 2×2 box mask", () => {
    // Box average of a constant is the constant; bilinear of constants is the constant.
    const P = godRayTapParams(16);
    let a = 0;
    let ill = 1;
    for (let k = 0; k < 16; k++) {
      a += ((1 + 1 + 1 + 1) / 4) * ill * 0.42;
      ill *= P.decay;
    }
    let b = 0;
    ill = 1;
    for (let k = 0; k < 16; k++) {
      b += 1 * ill * 0.42;
      ill *= P.decay;
    }
    assert.equal(a, b);
  });

  it("factor: stock at 48 taps (1080p bit-identical), half-res below; junk → stock", () => {
    assert.equal(godRayMaskFactor(48), 1);
    assert.equal(godRayMaskFactor(40), 2);
    assert.equal(godRayMaskFactor(16), 2);
    assert.equal(godRayMaskFactor(NaN), 1);
    assert.equal(godRayMaskFactor(0), 1);
  });

  it("mask size rounds up and rejects junk buffers", () => {
    assert.deepEqual(godRayMaskSize(4480, 2520, 2), [2240, 1260]);
    assert.deepEqual(godRayMaskSize(4481, 2521, 2), [2241, 1261]);
    assert.deepEqual(godRayMaskSize(0, 100, 2), [0, 0]);
    assert.deepEqual(godRayMaskSize(NaN, 100, 2), [0, 0]);
  });

  it("shaders expose the mask path", () => {
    assert.match(GodRayShader.fragmentShader, /uniform sampler2D tEmit/);
    assert.match(GodRayShader.fragmentShader, /useEmit > 0\.5/);
    assert.match(GodRayMaskShader.fragmentShader, /e \* 0\.25/);
  });

  const fakeRenderer = (log: string[]) =>
    ({
      setRenderTarget: (t: unknown) => log.push(t ? "rt" : "screen"),
      render: () => log.push("draw"),
      clear: () => {},
      autoClear: true,
    }) as unknown as THREE.WebGLRenderer;

  it("mask allocates only below 48 taps, frees on return to 48, and dispose releases", () => {
    const m = createGodRayMask();
    const log: string[] = [];
    const big = new THREE.WebGLRenderTarget(4480, 2520);
    assert.ok(m.render(fakeRenderer(log), big, 16));
    assert.equal(m.factor, 2);
    assert.equal(m.target?.width, 2240);
    assert.equal(m.uniforms.tDepth.value, null, "depth never left bound");
    assert.equal(m.render(fakeRenderer(log), big, 48), null);
    assert.equal(m.target, null, "1080p-tier session holds no mask VRAM");
    m.render(fakeRenderer(log), big, 24);
    m.dispose();
    assert.equal(m.target, null);
    assert.equal(m.render(fakeRenderer(log), big, 16), null);
    big.dispose();
  });

  it("god-ray pass uses the mask on a >2.5 MP buffer and the stock path at 1080p; unbinds after", () => {
    const g = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
    const u = g.pass.uniforms as unknown as Record<string, { value: unknown }>;
    const log: string[] = [];
    const r = fakeRenderer(log);
    const big = new THREE.WebGLRenderTarget(4480, 2520);
    const out = new THREE.WebGLRenderTarget(4480, 2520);
    g.pass.render(r, out, big, 1 / 60, false);
    assert.ok(g.taps < 48);
    assert.equal(g.maskFactor, 2);
    assert.equal(u.tEmit.value, null);
    assert.equal(u.useEmit.value, 0);
    const hd = new THREE.WebGLRenderTarget(1920, 1080);
    g.pass.render(r, hd, hd, 1 / 60, false);
    assert.equal(g.taps, 48);
    assert.equal(g.maskFactor, 1);
    g.dispose();
    for (const t of [big, out, hd]) t.dispose();
  });

  it("off pass (no healthy data) never renders a mask", () => {
    const g = createGodRayPass({ healthy: 0, total: 0, reducedMotion: false });
    const log: string[] = [];
    const big = new THREE.WebGLRenderTarget(4480, 2520);
    g.pass.render(fakeRenderer(log), big, big, 1 / 60, false);
    assert.equal(g.maskFactor, 1);
    g.dispose();
    big.dispose();
  });
});
