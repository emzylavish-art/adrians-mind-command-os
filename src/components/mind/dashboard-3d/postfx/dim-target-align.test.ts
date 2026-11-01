import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, type RegionReader } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass, type ContrastTarget } from "./detail-backdrop-dim.ts";
import { WCAG_GRAPHIC_AA, WCAG_TEXT_AA } from "./wcag-contrast.ts";

/**
 * Hacker pass (cycle after #83): setRects drops junk / off-canvas / zero-area
 * rects, which compacted the rect list — but per-rect contrast targets stayed
 * aligned to the CALLER's list. With the detail card off-canvas (or 0×0 mid
 * open-transition) the Charts rect slid into slot 0 and was planned with the
 * detail card's text/background target: the chart-line 3:1 plan was silently
 * dropped and the report named the wrong element.
 */
const vp = { width: 1000, height: 800 };
const offCanvasCard = { left: 2400, top: 100, width: 320, height: 500 };
const zeroCard = { left: 600, top: 100, width: 0, height: 0 };
const chart = { left: 40, top: 520, width: 420, height: 220 };
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1000, height: 800 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));
const reader = (grey: number): RegionReader => ({
  async read(_r, _s, rects) {
    return rects.map(() => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(grey));
  },
  dispose() {},
});

const detailTarget: ContrastTarget = { textRgb: [0.95, 0.95, 0.97], cardRgb: [0.05, 0.06, 0.1], cardAlpha: 0.6 };
const chartTarget: ContrastTarget = { textRgb: [0.95, 0.95, 0.95], lines: { rgb: [0.42, 0.55, 0.85] } };

async function run(first: typeof offCanvasCard) {
  let t = 0;
  const h = createDetailBackdropDimPass({ reader: reader(200), now: () => t });
  h.setRects([first, chart], vp, { reducedMotion: true });
  h.setContrastTarget([detailTarget, chartTarget]);
  h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
  await flush();
  t = 16;
  h.tick(16);
  return h;
}

describe("detail dim — targets stay aligned when a caller rect is dropped (hacker)", () => {
  for (const [name, first] of [["off-canvas", offCanvasCard], ["zero-area", zeroCard]] as const) {
    it(`${name} detail card → Charts keeps its own 3:1 line plan`, async () => {
      const h = await run(first);
      assert.equal(h.rects.length, 1, "only the chart rect is active");
      const plan = h.contrast.perRectPlans[0];
      assert.ok(plan, "chart rect is measured");
      assert.equal(plan!.target, WCAG_GRAPHIC_AA, "chart-line plan (not the detail card's text plan)");
      assert.ok(plan!.after >= WCAG_GRAPHIC_AA - 1e-6);
      assert.deepEqual(h.contrast.rectSource, [1], "report maps active rect 0 → caller index 1");
      h.dispose();
    });
  }

  it("all rects valid → identity mapping (unchanged #79 behaviour)", async () => {
    let t = 0;
    const h = createDetailBackdropDimPass({ reader: reader(200), now: () => t });
    h.setRects([{ left: 600, top: 100, width: 320, height: 300 }, chart], vp, { reducedMotion: true });
    h.setContrastTarget([detailTarget, chartTarget]);
    h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    assert.deepEqual(h.contrast.rectSource, [0, 1]);
    assert.equal(h.contrast.perRectPlans[0]!.target, WCAG_TEXT_AA);
    assert.equal(h.contrast.perRectPlans[1]!.target, WCAG_GRAPHIC_AA);
    h.dispose();
  });
});
