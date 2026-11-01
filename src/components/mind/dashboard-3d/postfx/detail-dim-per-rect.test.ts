import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, type RegionReader } from "./backdrop-meter.ts";
import { DIM_MAX, createDetailBackdropDimPass, measuredStrength } from "./detail-backdrop-dim.ts";
import { WCAG_GRAPHIC_AA, WCAG_TEXT_AA } from "./wcag-contrast.ts";

const vp = { width: 1000, height: 800 };
const card = { left: 600, top: 100, width: 320, height: 500 };
const chart = { left: 40, top: 520, width: 420, height: 220 };
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1000, height: 800 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Reader returning a different flat grey per rect index (real RGBA8 blocks). */
function perRectReader(greys: number[]): RegionReader {
  return {
    async read(_r, _s, rects) {
      return rects.map((_, i) => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(greys[i] ?? 0));
    },
    dispose() {},
  };
}

async function measured(greys: number[], target: Parameters<ReturnType<typeof createDetailBackdropDimPass>["setContrastTarget"]>[0]) {
  let t = 0;
  const h = createDetailBackdropDimPass({ reader: perRectReader(greys), now: () => t });
  h.setRects([card, chart], vp, { reducedMotion: true });
  h.setContrastTarget(target);
  h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
  await flush();
  t = 16;
  h.tick(16);
  return h;
}

const weights = (h: ReturnType<typeof createDetailBackdropDimPass>) =>
  (h.pass.uniforms as unknown as { rectWeight: { value: number[] } }).rectWeight.value;

describe("detail backdrop dim — per-rect measured strength (#69)", () => {
  it("dark nebula behind the card + bright nebula behind Charts → only the chart rect dims", async () => {
    const h = await measured([10, 235], { textRgb: [0.92, 0.93, 0.96] });
    const [cardS, chartS] = h.contrast.perRectStrength;
    assert.equal(cardS, 0, "card backdrop already passes — Imagine scene stays vivid");
    assert.ok(chartS! > 0, `chart strength ${chartS}`);
    assert.ok(Math.abs(h.strength - chartS!) < 1e-9, "peak = chart rect");
    assert.deepEqual(weights(h).map((w) => +w.toFixed(6)), [0, 1]);
    assert.equal(h.contrast.plan, h.contrast.perRectPlans[1], "report names the worst rect's plan");
    assert.ok(h.contrast.plan!.after >= WCAG_TEXT_AA - 1e-6);
    h.dispose();
  });

  it("chart lines get their own 3:1 plan; the rect uses whichever of text/lines needs more", async () => {
    // Mid-grey line colour fails 3:1 sooner than near-white tick text fails 4.5:1.
    const textOnly = await measured([10, 200], [null, { textRgb: [0.95, 0.95, 0.95] }]);
    const withLines = await measured([10, 200], [
      null,
      { textRgb: [0.95, 0.95, 0.95], lines: { rgb: [0.42, 0.55, 0.85] } },
    ]);
    const a = textOnly.contrast.perRectPlans[1]!;
    const b = withLines.contrast.perRectPlans[1]!;
    assert.equal(b.target, WCAG_GRAPHIC_AA, "line plan drives the chart rect");
    assert.ok(b.dim > a.dim, `${b.dim} > ${a.dim}`);
    assert.ok(b.after >= WCAG_GRAPHIC_AA - 1e-6);
    assert.equal(withLines.contrast.perRectPlans[0], null, "null entry → card stays on static dim");
    assert.equal(withLines.contrast.perRectStrength[0], DIM_MAX);
    const st = withLines.contrast.perRect[1]!;
    assert.ok(Math.abs(withLines.contrast.perRectStrength[1]! - measuredStrength(b.dim, st.p90)) < 1e-9);
    textOnly.dispose();
    withLines.dispose();
  });

  it("junk line colour is dropped (text-only), never guessed; all-junk targets → static", async () => {
    const h = await measured([10, 220], { textRgb: [0.9, 0.9, 0.9], lines: { rgb: [NaN, 0, 0] } });
    assert.notEqual(h.contrast.perRectPlans[1]!.target, WCAG_GRAPHIC_AA);
    h.setContrastTarget([{ textRgb: [NaN, 1, 1] }, null]);
    assert.equal(h.contrast.source, "static");
    assert.deepEqual(weights(h), [1, 1], "static #67: every rect at full weight");
    assert.equal(h.strength, DIM_MAX);
    h.dispose();
  });

  it("single-rect behaviour is unchanged from #68 (weight 1, strength = measured)", async () => {
    let t = 0;
    const h = createDetailBackdropDimPass({ reader: perRectReader([235]), now: () => t });
    h.setRects([card], vp, { reducedMotion: true });
    h.setContrastTarget({ textRgb: [0.9, 0.92, 0.96] });
    h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(weights(h)[0], 1);
    assert.ok(Math.abs(h.strength - measuredStrength(h.contrast.plan!.dim, h.contrast.backdropLum!)) < 1e-9);
    h.dispose();
  });
});
