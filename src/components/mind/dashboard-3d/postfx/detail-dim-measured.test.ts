import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, type RegionReader } from "./backdrop-meter.ts";
import {
  DIM_MAX,
  DIM_MEASURED_MAX,
  createDetailBackdropDimPass,
  measuredStrength,
} from "./detail-backdrop-dim.ts";
import { WCAG_TEXT_AA } from "./wcag-contrast.ts";

const vp = { width: 1000, height: 800 };
const card = { left: 600, top: 100, width: 320, height: 500 };
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1000, height: 800 } as never;
const writeBuffer = {} as never;

function fakeReader(grey: number | (() => number), opts: { fail?: boolean } = {}) {
  const calls: number[] = [];
  const reader: RegionReader = {
    async read(_r, _src, rects) {
      calls.push(rects.length);
      if (opts.fail) throw new Error("readback lost");
      const g = typeof grey === "function" ? grey() : grey;
      return rects.map(() => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(g));
    },
    dispose() {},
  };
  return { reader, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("detail backdrop dim — measured luminance (#68)", () => {
  it("no contrast target → #67 static dim, never reads", async () => {
    const { reader, calls } = fakeReader(240);
    const h = createDetailBackdropDimPass({ reader, now: () => 0 });
    h.setRects([card], vp, { reducedMotion: true });
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(h.strength, DIM_MAX);
    assert.equal(h.contrast.source, "static");
    h.dispose();
  });

  it("bright measured backdrop → stronger dim that reaches WCAG 4.5:1", async () => {
    let t = 0;
    const { reader, calls } = fakeReader(235);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setRects([card], vp, { reducedMotion: true });
    h.setContrastTarget({ textRgb: [0.9, 0.92, 0.96] });
    assert.equal(h.contrast.source, "static", "static until a real read lands");
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(calls.length, 1);
    assert.equal(h.contrast.source, "measured");
    const plan = h.contrast.plan!;
    assert.ok(plan.after >= WCAG_TEXT_AA - 1e-6 && plan.reachable);
    assert.ok(h.strength > DIM_MAX && h.strength <= DIM_MEASURED_MAX + 1e-9, `${h.strength}`);
    assert.ok(Math.abs(h.strength - measuredStrength(plan.dim, h.contrast.backdropLum!)) < 1e-9);
    h.dispose();
  });

  it("dark measured backdrop → no dim (Imagine scene stays vivid) but pass keeps measuring", async () => {
    let t = 0;
    const { reader, calls } = fakeReader(12);
    const h = createDetailBackdropDimPass({ reader, now: () => t, intervalMs: 500 });
    h.setRects([card], vp, { reducedMotion: false });
    h.setContrastTarget({ textRgb: [1, 1, 1] });
    for (let i = 0; i < 20; i++) h.tick(16);
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    for (let i = 0; i < 60; i++) {
      t += 16;
      h.tick(16);
    }
    assert.equal(h.contrast.source, "measured");
    assert.ok(h.strength < 0.01, `eased to ~0, got ${h.strength}`);
    assert.equal(h.pass.enabled, true, "kept alive to re-measure when the nebula drifts");
    t = 600;
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    assert.equal(calls.length, 2, "re-measures every interval");
    h.dispose();
  });

  it("measured change eases (no pop) unless reduced motion", async () => {
    let t = 0;
    const { reader } = fakeReader(235);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setRects([card], vp);
    h.setContrastTarget({ textRgb: [0.9, 0.92, 0.96] });
    for (let i = 0; i < 30; i++) h.tick(16); // fully open at static DIM_MAX
    assert.ok(Math.abs(h.strength - DIM_MAX) < 1e-6);
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    const goal = measuredStrength(h.contrast.plan!.dim, h.contrast.backdropLum!);
    assert.ok(h.strength > DIM_MAX && h.strength < goal, "one frame moves part-way");
    for (let i = 0; i < 100; i++) h.tick(16);
    assert.ok(Math.abs(h.strength - goal) < 1e-3);
    h.dispose();
  });

  it("read failure / hidden tab / stale reading → static dim, error surfaced", async () => {
    let t = 0;
    const bad = fakeReader(200, { fail: true });
    const h = createDetailBackdropDimPass({ reader: bad.reader, now: () => t });
    h.setRects([card], vp, { reducedMotion: true });
    h.setContrastTarget({ textRgb: [1, 1, 1] });
    h.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    h.tick(16);
    assert.equal(h.contrast.source, "static");
    assert.match(h.contrast.lastError!, /readback lost/);
    assert.equal(h.strength, DIM_MAX);
    h.dispose();

    const ok = fakeReader(235);
    const h2 = createDetailBackdropDimPass({ reader: ok.reader, now: () => t });
    h2.setRects([card], vp, { reducedMotion: true });
    h2.setContrastTarget({ textRgb: [1, 1, 1] });
    h2.setHidden(true);
    h2.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    assert.equal(ok.calls.length, 0, "hidden tab never reads back");
    h2.setHidden(false);
    h2.pass.render(fakeRenderer, writeBuffer, readBuffer, 0, false);
    await flush();
    h2.tick(16);
    assert.equal(h2.contrast.source, "measured");
    t = 10_000; // reading far older than METER_MAX_AGE_MS
    h2.tick(16);
    assert.equal(h2.contrast.source, "static", "stale reading is never reused");
    h2.setContrastTarget({ textRgb: [NaN, 1, 1] }); // junk colour → static, not a guess
    assert.equal(h2.contrast.source, "static");
    h2.dispose();
  });

  it("dispose disposes an owned reader; injected reader left to caller", () => {
    let disposed = 0;
    const reader: RegionReader = { read: async () => [], dispose: () => void disposed++ };
    const h = createDetailBackdropDimPass({ reader });
    h.dispose();
    assert.equal(disposed, 0);
    assert.equal(h.pass.enabled, false);
  });
});
