import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, METER_MAX_AGE_MS, type RegionReader } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass, type UvRect } from "./detail-backdrop-dim.ts";
import {
  CARD_SURROUND_SCALE,
  EDGE_MAX,
  EDGE_SEP_RATIO,
  EDGE_SHADE_ABOVE,
  EDGE_SHADE_HYST,
  cardSurroundRatio,
  createCardEdgePass,
  edgeAgeFade,
  edgeApply,
  edgeModeFromPeak,
  edgeRimBand,
  edgeSeparationGain,
  splitProbeBlock,
} from "./card-edge.ts";
import { formatMeterBadge } from "./meter-badge.ts";

/**
 * #93: Imagine card edge separation from the MEASURED card-vs-surround
 * contrast (core vs ring of the #84 probe block — same slot, same readback).
 */
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1600, height: 900 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));
const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
/** METER_EDGE² RGBA block: texels within 1 card radius = `card` grey, else `surround` grey. */
function block(card: number, surround: number, scale = CARD_SURROUND_SCALE): Uint8Array {
  const e = METER_EDGE;
  const b = new Uint8Array(e * e * 4);
  for (let y = 0; y < e; y++)
    for (let x = 0; x < e; x++) {
      const d = Math.hypot((((x + 0.5) / e) * 2 - 1) * scale, (((y + 0.5) / e) * 2 - 1) * scale);
      const g = d <= 1 ? card : surround;
      b.set([g, g, g, 255], (y * e + x) * 4);
    }
  return b;
}
function blockReader(card: number, surround: number) {
  const calls: UvRect[][] = [];
  const reader: RegionReader = {
    async read(_r, _s, rects) {
      calls.push(rects.map((r) => [...r] as UvRect));
      return rects.map(() => block(card, surround));
    },
    dispose() {},
  };
  return { reader, calls };
}
async function measured(card: number, surround: number, pos = new THREE.Vector3(0, 0, 0), r: number | null = 0.1) {
  let t = 0;
  const { reader, calls } = blockReader(card, surround);
  const dim = createDetailBackdropDimPass({ reader, now: () => t });
  dim.setCardProbe(true);
  dim.setCardSurround(true);
  dim.setHole(pos, cam(), r);
  dim.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
  await flush();
  t = 16;
  dim.tick(16);
  return { dim, calls };
}

describe("#93 pure maths", () => {
  it("splitProbeBlock separates core and ring texels; junk → null", () => {
    const sp = splitProbeBlock(block(200, 30), METER_EDGE)!;
    assert.ok(sp.core.mean > 0.5 && sp.ring.mean < 0.02, `core ${sp.core.mean} ring ${sp.ring.mean}`);
    assert.equal(sp.core.samples, 12);
    assert.equal(sp.ring.samples, 32);
    assert.equal(splitProbeBlock(null, METER_EDGE), null);
    assert.equal(splitProbeBlock(new Uint8Array(10), METER_EDGE), null);
    assert.equal(splitProbeBlock(block(1, 1), METER_EDGE, 1), null, "scale 1 has no ring outside the card");
  });

  it("gain comes only from a real ratio: melt → full, ≥1.5:1 → off, null → off", () => {
    const s = (mean: number) => ({ mean, p90: mean, max: mean, samples: 4 });
    assert.equal(cardSurroundRatio(s(0.1), s(0.1)), 1);
    assert.equal(edgeSeparationGain(1), EDGE_MAX);
    assert.equal(edgeSeparationGain(EDGE_SEP_RATIO), 0);
    assert.equal(edgeSeparationGain(3), 0);
    assert.equal(edgeSeparationGain(null), 0);
    assert.equal(edgeSeparationGain(NaN), 0);
    assert.ok(edgeSeparationGain(1.2) > edgeSeparationGain(1.4));
    assert.equal(cardSurroundRatio(s(0.1), null), null);
    assert.equal(cardSurroundRatio(s(NaN), s(0.1)), null);
    assert.equal(cardSurroundRatio({ ...s(0.1), samples: 0 }, s(0.1)), null);
  });

  it("rim band sits just outside the card bound; light rim never clips, shade darkens", () => {
    assert.equal(edgeRimBand(0, 0.1), 0, "card interior untouched");
    assert.ok(edgeRimBand(0.1, 0.1) > 0.99, "peak at the bound");
    assert.equal(edgeRimBand(0.2, 0.1), 0, "far nebula untouched");
    assert.equal(edgeRimBand(0.1, 0), 0);
    const lit = edgeApply([0.98, 0.98, 0.98], 1, EDGE_MAX, "light");
    assert.ok(lit.every((c) => c <= 1));
    const sh = edgeApply([0.8, 0.8, 0.8], 1, EDGE_MAX, "shade");
    assert.ok(sh[0] < 0.8);
    assert.deepEqual(edgeApply([0.3, 0.4, 0.5], 0, EDGE_MAX, "light"), [0.3, 0.4, 0.5]);
  });
});

describe("#93 card + surround measured from the probe slot", () => {
  it("surround on: one slot at 1.5× radius, card = core, surround = ring", async () => {
    const { dim, calls } = await measured(200, 20);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.length, 1, "readback cost unchanged: one probe slot");
    const p = calls[0]![0]!;
    assert.ok(Math.abs(p[3] - p[1] - 2 * 0.1 * CARD_SURROUND_SCALE) < 1e-9, "probe read at surround scale");
    const c = dim.contrast.card!;
    assert.ok(c.stats.mean > 0.5, "core is the bright card");
    assert.ok(c.surround && c.surround.mean < 0.01, "ring is the dark nebula");
    dim.dispose();
  });

  it("surround off → #84 behaviour (1× rect), surround null", async () => {
    let t = 0;
    const { reader, calls } = blockReader(200, 20);
    const dim = createDetailBackdropDimPass({ reader, now: () => t });
    dim.setCardProbe(true);
    dim.setHole(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    dim.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
    await flush();
    t = 16;
    dim.tick(16);
    const p = calls[0]![0]!;
    assert.ok(Math.abs(p[3] - p[1] - 0.2) < 1e-9);
    assert.equal(dim.contrast.card!.surround ?? null, null);
    dim.dispose();
  });

  it("card clamped at the canvas edge → plain #84 rect, no surround reading (never a distorted split)", async () => {
    const { dim, calls } = await measured(40, 40, new THREE.Vector3(8, 0, 0));
    assert.equal(calls.length, 1);
    assert.ok(dim.contrast.card, "card still metered for the key lift");
    assert.equal(dim.contrast.card!.surround, null);
    const edge = createCardEdgePass();
    edge.setFocus(new THREE.Vector3(8, 0, 0), cam(), 0.1);
    edge.setSeparation(dim.contrast.card, { reducedMotion: true });
    assert.equal(edge.pass.enabled, false);
    assert.equal(edge.report.ratio, null);
    dim.dispose();
    edge.dispose();
  });
});

describe("#93 card edge pass", () => {
  it("card melts into same-luminance nebula → full cool light rim", async () => {
    const { dim } = await measured(40, 40);
    const edge = createCardEdgePass();
    assert.equal(edge.pass.enabled, false, "off until a reading");
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    edge.setSeparation(dim.contrast.card, { reducedMotion: true });
    assert.equal(edge.report.source, "measured");
    assert.ok(Math.abs(edge.report.ratio! - 1) < 1e-9);
    assert.equal(edge.report.gain, EDGE_MAX);
    assert.equal(edge.report.mode, "light");
    assert.equal(edge.pass.enabled, true);
    const badge = formatMeterBadge(dim.contrast, null, edge.report).text;
    assert.match(badge, /edge 1\.00:1 rim \+0\.32 \(light\)/);
    edge.dispose();
    assert.equal(edge.pass.enabled, false);
    dim.dispose();
  });

  it("bright card on bright nebula → shade halo; well-separated card → no rim", async () => {
    const a = await measured(210, 210);
    const edge = createCardEdgePass();
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    edge.setSeparation(a.dim.contrast.card, { reducedMotion: true });
    assert.equal(edge.report.mode, "shade");
    const b = await measured(200, 20);
    edge.setSeparation(b.dim.contrast.card, { reducedMotion: true });
    assert.ok(edge.report.ratio! > EDGE_SEP_RATIO);
    assert.equal(edge.report.gain, 0);
    assert.equal(edge.pass.enabled, false);
    assert.match(formatMeterBadge(b.dim.contrast, null, edge.report).text, /edge \d+\.\d\d:1 ok/);
    a.dim.dispose();
    b.dim.dispose();
    edge.dispose();
  });

  it("no reading / no real radius / focus lost → no rim (eases out)", async () => {
    const { dim } = await measured(40, 40);
    const edge = createCardEdgePass();
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), null);
    edge.setSeparation(dim.contrast.card, { reducedMotion: true });
    assert.equal(edge.pass.enabled, false, "guessed radius never drives a rim");
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    edge.setSeparation(null, { reducedMotion: true });
    assert.equal(edge.pass.enabled, false);
    assert.match(formatMeterBadge(dim.contrast, null, edge.report).text, /edge no reading/);
    edge.setSeparation(dim.contrast.card);
    edge.tick(16);
    assert.ok(edge.report.gain > 0 && edge.report.gain < EDGE_MAX, "eases in");
    edge.setFocus(null, cam(), 0.1);
    for (let i = 0; i < 200; i++) edge.tick(16);
    assert.equal(edge.report.gain, 0);
    assert.equal(edge.pass.enabled, false);
    dim.dispose();
    edge.dispose();
  });
});


describe("#103 hacker: edge-mode hysteresis + measurement-age fade", () => {
  it("hard 0.35 threshold would flap; hysteresis holds until past 0.40 / 0.30", () => {
    // Reproduce the live bug: max(card, surround) hovering around EDGE_SHADE_ABOVE
    // flipped light↔shade between ~500 ms meter reads (visible flash).
    const hard = (peak: number) => (peak > EDGE_SHADE_ABOVE ? "shade" : "light");
    assert.equal(hard(0.349), "light");
    assert.equal(hard(0.351), "shade"); // one float step → mode flash

    // First reading still uses the hard threshold.
    assert.equal(edgeModeFromPeak(0.34, null), "light");
    assert.equal(edgeModeFromPeak(0.36, null), "shade");

    // Once light, stay light through the band; only flip past 0.40.
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE, "light"), "light");
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE + EDGE_SHADE_HYST, "light"), "light");
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE + EDGE_SHADE_HYST + 0.001, "light"), "shade");

    // Once shade, stay shade through the band; only flip below 0.30.
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE, "shade"), "shade");
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE - EDGE_SHADE_HYST, "shade"), "shade");
    assert.equal(edgeModeFromPeak(EDGE_SHADE_ABOVE - EDGE_SHADE_HYST - 0.001, "shade"), "light");

    assert.equal(edgeModeFromPeak(NaN, "shade"), "shade");
    assert.equal(edgeModeFromPeak(-1, null), "light");
  });

  it("pass keeps light mode across a 0.35-hover sequence that used to flash", () => {
    let t = 0;
    const edge = createCardEdgePass({ now: () => t });
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    const melt = (mean: number, atMs: number) => ({
      stats: { mean, p90: mean, max: mean, samples: 4 },
      surround: { mean, p90: mean, max: mean, samples: 4 },
      atMs,
    });
    // First reading just under the hard threshold → light.
    edge.setSeparation(melt(0.34, 0), { reducedMotion: true, nowMs: 0 });
    assert.equal(edge.report.mode, "light");
    assert.equal(edge.report.gain, EDGE_MAX);
    // Next read sits just above 0.35 — old code flipped to shade; hysteresis holds light.
    edge.setSeparation(melt(0.36, 500), { reducedMotion: true, nowMs: 500 });
    assert.equal(edge.report.mode, "light");
    // Only past 0.40 does it become shade.
    edge.setSeparation(melt(0.41, 1000), { reducedMotion: true, nowMs: 1000 });
    assert.equal(edge.report.mode, "shade");
    // Drop back to 0.34 — stays shade until below 0.30.
    edge.setSeparation(melt(0.34, 1500), { reducedMotion: true, nowMs: 1500 });
    assert.equal(edge.report.mode, "shade");
    edge.setSeparation(melt(0.29, 2000), { reducedMotion: true, nowMs: 2000 });
    assert.equal(edge.report.mode, "light");
    edge.dispose();
  });

  it("edgeAgeFade is full when fresh, 0 at/past METER_MAX_AGE, and ages the live rim", () => {
    assert.equal(edgeAgeFade(null), 1);
    assert.equal(edgeAgeFade(0), 1);
    assert.equal(edgeAgeFade(METER_MAX_AGE_MS * 0.5), 1);
    assert.equal(edgeAgeFade(METER_MAX_AGE_MS), 0);
    assert.equal(edgeAgeFade(METER_MAX_AGE_MS + 50), 0);
    assert.ok(edgeAgeFade(METER_MAX_AGE_MS * 0.75) < 1 && edgeAgeFade(METER_MAX_AGE_MS * 0.75) > 0);

    let t = 0;
    const edge = createCardEdgePass({ now: () => t });
    edge.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    const card = {
      stats: { mean: 0.2, p90: 0.2, max: 0.2, samples: 4 },
      surround: { mean: 0.2, p90: 0.2, max: 0.2, samples: 4 },
      atMs: 0,
    };
    edge.setSeparation(card, { reducedMotion: true, nowMs: 0 });
    assert.equal(edge.report.gain, EDGE_MAX);
    // Near expiry the rim must be gone (no rim from a reading near METER_MAX_AGE).
    t = METER_MAX_AGE_MS - 1;
    edge.tick(16);
    assert.ok(edge.report.targetGain < 0.02, `near-expiry target ${edge.report.targetGain}`);
    t = METER_MAX_AGE_MS;
    edge.tick(16);
    assert.equal(edge.report.targetGain, 0);
    assert.equal(edge.pass.enabled, false);
    edge.dispose();
  });
});
