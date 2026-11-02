import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  GOD_RAY_MAX_TAPS,
  GOD_RAY_MIN_TAPS,
  createGodRayBudget,
  godRayTapParams,
  godRayTapsFor,
  godRayUniformEnergy,
} from "./god-ray-budget.ts";
import { createGodRayPass } from "./god-rays.ts";
import { postfxViewport } from "./viewport-rebind.ts";

describe("god-ray adaptive tap budget (#109)", () => {
  it("full 48 taps up to ~2.5 MP; fewer on 4K/retina buffers; floor 16; junk → 48", () => {
    assert.equal(godRayTapsFor(1920, 1080), 48);
    const retina = postfxViewport(1512, 982, 2); // MBP 14 @ cap 1.75
    assert.ok(godRayTapsFor(retina.bufW, retina.bufH) < 48);
    const uhd = postfxViewport(3840, 2160, 1);
    const t4k = godRayTapsFor(uhd.bufW, uhd.bufH);
    assert.ok(t4k >= GOD_RAY_MIN_TAPS && t4k < 16 + 1 + 15, String(t4k));
    // cost (px × taps) stays at or under the 2.5 MP × 48 reference
    // cost (px × taps) stays at the 2.5 MP × 48 reference unless pinned at the floor
    assert.ok(t4k === GOD_RAY_MIN_TAPS || uhd.bufW * uhd.bufH * t4k <= 2_500_000 * 48 + 1);
    const rt = godRayTapsFor(retina.bufW, retina.bufH);
    assert.ok(retina.bufW * retina.bufH * rt <= 2_500_000 * 48 + 1, String(rt));
    assert.equal(godRayTapsFor(20000, 20000), GOD_RAY_MIN_TAPS);
    for (const j of [Number.NaN, -1, 0, Infinity]) assert.equal(godRayTapsFor(j, 100), 48);
  });

  it("re-based decay keeps the same falloff over the reach and EXACT uniform energy (no pop)", () => {
    const ref = godRayTapParams(48);
    assert.ok(Math.abs(ref.decay - 0.955) < 1e-12);
    assert.ok(Math.abs(ref.norm - 1 / 12) < 1e-12, "48 taps = legacy /(48*0.25)");
    const e48 = godRayUniformEnergy(ref);
    for (const n of [40, 32, 24, 16]) {
      const p = godRayTapParams(n);
      assert.ok(Math.abs(Math.pow(p.decay, n) - Math.pow(0.955, 48)) < 1e-9);
      assert.ok(Math.abs(godRayUniformEnergy(p) - e48) < 1e-9, `taps ${n}`);
    }
    assert.equal(godRayTapParams(Number.NaN).taps, 48);
    assert.equal(godRayTapParams(3).taps, GOD_RAY_MIN_TAPS);
    assert.equal(godRayTapParams(999).taps, GOD_RAY_MAX_TAPS);
  });

  it("frame-time backoff steps down after sustained slow frames and recovers with hysteresis", () => {
    const b = createGodRayBudget({ slowHold: 5, fastHold: 10, alpha: 1 });
    b.setBuffer(1920, 1080);
    for (let i = 0; i < 4; i++) b.sampleFrame(30);
    assert.equal(b.taps, 48, "not yet");
    b.sampleFrame(30);
    assert.equal(b.taps, 40);
    for (let i = 0; i < 100; i++) b.sampleFrame(30);
    assert.equal(b.taps, 16, "floor");
    // in-band frames (between fast and slow) hold steady
    for (let i = 0; i < 100; i++) b.sampleFrame(20);
    assert.equal(b.taps, 16);
    for (let i = 0; i < 10; i++) b.sampleFrame(10);
    assert.equal(b.taps, 24);
  });

  it("ignores tab-hidden spikes and junk deltas", () => {
    const b = createGodRayBudget({ slowHold: 2, alpha: 1 });
    b.setBuffer(1920, 1080);
    for (const ms of [5000, Number.NaN, -3, 0, Infinity, 400]) b.sampleFrame(ms);
    assert.equal(b.taps, 48);
    assert.equal(b.frameEmaMs, null);
  });

  it("backoff jumps past tiers that would not lower an already size-capped tap count", () => {
    const b = createGodRayBudget({ slowHold: 1, alpha: 1 });
    const retina = postfxViewport(1512, 982, 2);
    const cap = b.setBuffer(retina.bufW, retina.bufH);
    assert.ok(cap > 24 && cap < 40, String(cap));
    b.sampleFrame(40);
    assert.ok(b.taps < cap, `${b.taps} < ${cap}`);
  });

  it("pass self-reads readBuffer size each render and writes taps/decay/norm uniforms", () => {
    const g = createGodRayPass({ healthy: 5, total: 5, reducedMotion: false });
    assert.equal(g.taps, 48);
    const writes: string[] = [];
    const renderer = {
      setRenderTarget: () => writes.push("rt"),
      render: () => writes.push("draw"),
      clear: () => {},
      autoClear: true,
    } as unknown as THREE.WebGLRenderer;
    const read = new THREE.WebGLRenderTarget(3840, 2160);
    const write = new THREE.WebGLRenderTarget(3840, 2160);
    g.pass.render(renderer, write, read, 1 / 60, false);
    assert.ok(g.taps < 48 && g.taps >= 16, String(g.taps));
    const p = g.tapParams;
    assert.ok(Math.abs(godRayUniformEnergy(p) - godRayUniformEnergy(godRayTapParams(48))) < 1e-9);
    read.setSize(1280, 720);
    g.pass.render(renderer, write, read, 1 / 60, false);
    assert.equal(g.taps, 48, "shrinking the buffer restores full taps");
    assert.equal(g.setBufferSize(3840, 2160) < 48, true);
    g.dispose();
    read.dispose();
    write.dispose();
  });

  it("adaptive:false pins 48 taps", () => {
    const g = createGodRayPass({ healthy: 5, total: 5, reducedMotion: false }, { adaptive: false });
    const renderer = { setRenderTarget: () => {}, render: () => {}, clear: () => {}, autoClear: true } as unknown as THREE.WebGLRenderer;
    const rt = new THREE.WebGLRenderTarget(3840, 2160);
    g.pass.render(renderer, rt, rt, 1 / 60, false);
    assert.equal(g.taps, 48);
    g.dispose();
  });
});
