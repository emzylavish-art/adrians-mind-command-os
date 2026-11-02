import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, measureLuminance, type RegionReader } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass } from "./detail-backdrop-dim.ts";
import {
  PLATE_FLATTEN,
  PLATE_MAX,
  PLATE_SPREAD_HI,
  PLATE_SPREAD_LO,
  createChartsDepthPlatePass,
  plateApply,
  plateMask,
  plateSpread,
  plateStatsFor,
  plateStrengthFromSpread,
} from "./charts-depth-plate.ts";
import { formatMeterBadge } from "./meter-badge.ts";

/**
 * #102: Charts depth plate — strength ONLY from the measured spread (max −
 * mean) of the #69 per-rect reading under the Charts rect; no extra readback.
 */
const vp = { width: 1000, height: 800 };
const card = { left: 600, top: 100, width: 320, height: 500 };
const chart = { left: 40, top: 520, width: 420, height: 220 };
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1000, height: 800 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

const flat = (g: number) => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(g);
/** Busy block: dark sky with a few bright star texels (high max − mean). */
const busy = () => {
  const b = flat(18);
  for (const i of [3, 17, 40, 58]) b.fill(250, i * 4, i * 4 + 3);
  return b;
};
function reader(blocks: (() => Uint8Array)[]): RegionReader {
  return {
    async read(_r, _s, rects) {
      return rects.map((_, i) => (blocks[i] ?? (() => flat(0)))());
    },
    dispose() {},
  };
}
async function dimWith(blocks: (() => Uint8Array)[], rects: (typeof card | null)[]) {
  let t = 0;
  const h = createDetailBackdropDimPass({ reader: reader(blocks), now: () => t });
  h.setRects(rects, vp, { reducedMotion: true });
  h.setContrastTarget(rects.map(() => ({ textRgb: [0.92, 0.93, 0.96] as [number, number, number] })));
  h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
  await flush();
  t = 16;
  h.tick(16);
  return { h, setT: (v: number) => (t = v) };
}
const uni = (p: ReturnType<typeof createChartsDepthPlatePass>) =>
  p.pass.uniforms as unknown as {
    rect: { value: THREE.Vector4 };
    strength: { value: number };
    blurStep: { value: THREE.Vector2 };
    feather: { value: THREE.Vector2 };
    meanEnc: { value: number };
  };

describe("charts depth plate (#102) — pure maths", () => {
  it("spread is max − mean of a real reading; junk → null", () => {
    const s = measureLuminance(busy(), METER_EDGE, METER_EDGE)!;
    assert.ok(Math.abs(plateSpread(s)! - (s.max - s.mean)) < 1e-12);
    assert.equal(plateSpread(null), null);
    assert.equal(plateSpread({ mean: NaN, p90: 0, max: 1, samples: 4 }), null);
    assert.equal(plateSpread({ mean: 0.5, p90: 0.5, max: 0.2, samples: 4 }), null, "max < mean is junk");
    assert.equal(plateSpread({ mean: 0.1, p90: 0.1, max: 0.5, samples: 0 }), null);
  });

  it("strength: ≤ LO → 0, ≥ HI → PLATE_MAX, monotonic between", () => {
    assert.equal(plateStrengthFromSpread(null), 0);
    assert.equal(plateStrengthFromSpread(NaN), 0);
    assert.equal(plateStrengthFromSpread(PLATE_SPREAD_LO), 0);
    assert.equal(plateStrengthFromSpread(PLATE_SPREAD_HI), PLATE_MAX);
    assert.equal(plateStrengthFromSpread(1), PLATE_MAX);
    const a = plateStrengthFromSpread(0.08);
    const b = plateStrengthFromSpread(0.12);
    assert.ok(a > 0 && b > a && b < PLATE_MAX);
  });

  it("plateApply: mask 0 / strength 0 → unchanged; full → blurred + highlights compressed toward mean", () => {
    const px: [number, number, number] = [0.9, 0.9, 0.9];
    const blur: [number, number, number] = [0.5, 0.5, 0.5];
    assert.deepEqual(plateApply(px, blur, 0, PLATE_MAX, 0.2), px);
    assert.deepEqual(plateApply(px, blur, 1, 0, 0.2), px);
    const out = plateApply(px, blur, 1, PLATE_MAX, 0.2);
    const mixed = 0.9 + (0.5 - 0.9) * PLATE_MAX;
    const expect = 0.2 + (mixed - 0.2) * (1 - PLATE_FLATTEN * PLATE_MAX);
    assert.ok(Math.abs(out[0] - expect) < 1e-9, `${out[0]} vs ${expect}`);
    // Below the measured mean: only the blur mix, never brightened/darkened further.
    const dark = plateApply([0.05, 0.05, 0.05], [0.05, 0.05, 0.05], 1, PLATE_MAX, 0.2);
    assert.ok(Math.abs(dark[0] - 0.05) < 1e-12);
  });

  it("plateMask: 1 inside, feathered outside, junk → 0", () => {
    const r: [number, number, number, number] = [0.2, 0.2, 0.4, 0.4];
    assert.equal(plateMask(0.3, 0.3, r, 0.01, 0.01), 1);
    assert.equal(plateMask(0.6, 0.3, r, 0.01, 0.01), 0);
    const m = plateMask(0.405, 0.3, r, 0.01, 0.01);
    assert.ok(m > 0 && m < 1);
    assert.equal(plateMask(NaN, 0.3, r, 0.01, 0.01), 0);
  });
});

describe("charts depth plate (#102) — wired to the real dim report", () => {
  it("busy star field behind Charts (caller index 1) → plate on, on the Charts rect only", async () => {
    const { h } = await dimWith([() => flat(20), busy], [card, chart]);
    const hit = plateStatsFor(h.contrast, h.rects, 1)!;
    assert.ok(hit, "charts reading found");
    assert.deepEqual(hit.rect, h.rects[1]);
    const p = createChartsDepthPlatePass();
    p.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    p.tick(16);
    assert.equal(p.report.source, "measured");
    assert.ok(Math.abs(p.report.spread! - (hit.stats.max - hit.stats.mean)) < 1e-12, "spread is the real reading");
    assert.equal(p.pass.enabled, true);
    const r = h.rects[1]!;
    assert.deepEqual(uni(p).rect.value.toArray(), [r[0], r[1], r[2], r[3]]);
    assert.ok(uni(p).strength.value > 0);
    p.dispose();
    h.dispose();
  });

  it("flat backdrop behind Charts → no plate (byte-identical frame)", async () => {
    const { h } = await dimWith([busy, () => flat(40)], [card, chart]);
    const p = createChartsDepthPlatePass();
    p.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    p.tick(16);
    assert.equal(p.report.spread, 0);
    assert.equal(p.report.source, "none");
    assert.equal(p.pass.enabled, false, "busy DETAIL backdrop must not plate the Charts");
    h.dispose();
  });

  it("detail card off-canvas (dropped) → Charts still found by caller index, not shifted", async () => {
    const off = { left: -900, top: -900, width: 10, height: 10 };
    const { h } = await dimWith([busy], [off, chart]);
    assert.deepEqual(h.contrast.rectSource, [1]);
    assert.ok(plateStatsFor(h.contrast, h.rects, 1), "charts = caller 1 → active 0");
    assert.equal(plateStatsFor(h.contrast, h.rects, 0), null, "dropped detail rect has no reading");
    h.dispose();
  });

  it("no reading / stale reading / no Charts index / junk viewport → off", async () => {
    const p = createChartsDepthPlatePass();
    p.setPlate(null, null, 1, vp, { reducedMotion: true });
    p.tick(16);
    assert.equal(p.pass.enabled, false);
    assert.equal(p.report.spread, null);
    const { h, setT } = await dimWith([() => flat(20), busy], [card, chart]);
    for (const idx of [null, -1, 2, 1.5]) {
      p.setPlate(h.contrast, h.rects, idx as number | null, vp, { reducedMotion: true });
      p.tick(16);
      assert.equal(p.pass.enabled, false, `caller index ${idx}`);
    }
    p.setPlate(h.contrast, h.rects, 1, { width: 0, height: 800 }, { reducedMotion: true });
    p.tick(16);
    assert.equal(p.pass.enabled, false, "zero viewport");
    // Stale: 5 s later with no new read the dim reports no perRect → plate off.
    setT(5000);
    h.tick(16);
    p.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    p.tick(16);
    assert.equal(p.report.spread, null, "stale reading is not used");
    assert.equal(p.pass.enabled, false);
    p.dispose();
    h.dispose();
  });

  it("eases in without reduced motion; reduced motion snaps", async () => {
    const { h } = await dimWith([() => flat(20), busy], [card, chart]);
    const p = createChartsDepthPlatePass();
    p.setPlate(h.contrast, h.rects, 1, vp);
    p.tick(16);
    const s1 = p.report.strength;
    assert.ok(s1 > 0 && s1 < p.report.targetStrength, "partial after one frame");
    for (let i = 0; i < 200; i++) p.tick(16);
    assert.ok(Math.abs(p.report.strength - p.report.targetStrength) < 1e-9);
    const q = createChartsDepthPlatePass();
    q.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    assert.equal(q.report.strength, q.report.targetStrength, "snap");
    p.dispose();
    q.dispose();
    h.dispose();
  });

  it("blur / feather are CSS-px based (DPR / composer setSize never change them)", async () => {
    const { h } = await dimWith([() => flat(20), busy], [card, chart]);
    const p = createChartsDepthPlatePass();
    p.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    const before = [uni(p).blurStep.value.toArray(), uni(p).feather.value.toArray()];
    p.pass.setSize(vp.width * 3, vp.height * 3); // composer at DPR 3
    assert.deepEqual([uni(p).blurStep.value.toArray(), uni(p).feather.value.toArray()], before);
    p.dispose();
    h.dispose();
  });

  it("separate instances never share uniform vectors; dispose → off and inert", async () => {
    const a = createChartsDepthPlatePass();
    const b = createChartsDepthPlatePass();
    assert.notEqual(uni(a).rect.value, uni(b).rect.value);
    const { h } = await dimWith([() => flat(20), busy], [card, chart]);
    a.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    a.dispose();
    assert.equal(a.pass.enabled, false);
    assert.equal(a.report.strength, 0);
    a.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    a.tick(16);
    assert.equal(a.pass.enabled, false, "disposed stays off");
    a.dispose(); // idempotent
    b.dispose();
    h.dispose();
  });

  it("badge prints only the real spread", async () => {
    const { h } = await dimWith([() => flat(20), busy], [card, chart]);
    const p = createChartsDepthPlatePass();
    assert.match(formatMeterBadge(h.contrast, null, null, p.report).text, /plate no reading/);
    p.setPlate(h.contrast, h.rects, 1, vp, { reducedMotion: true });
    assert.match(formatMeterBadge(h.contrast, null, null, p.report).text, /plate spread \d\.\d\d \+\d\.\d\d/);
    p.dispose();
    h.dispose();
  });
});
