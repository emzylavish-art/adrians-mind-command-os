import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, METER_INTERVAL_MS, METER_SLOW_READ_MS, type RegionReader } from "./backdrop-meter.ts";
import { METER_SLOTS, cardProbeRect, createDetailBackdropDimPass, type UvRect } from "./detail-backdrop-dim.ts";
import { KEY_LIFT_MAX, createSceneKeyLiftPass, liftBackdrop } from "./scene-key-lift.ts";
import { formatMeterBadge } from "./meter-badge.ts";

/**
 * #84: meter the focused Imagine card's OWN projected rect, so the #83 key
 * lift has a real reading when no detail card / chart sits behind the card,
 * and the badge reports card vs panel luminance separately.
 */
const vp = { width: 1600, height: 900 };
const chart = { left: 40, top: 620, width: 420, height: 220 };
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

/** Reader: slot i → flat grey greys[i]; records every rect list it was asked to read. */
function recReader(greys: number[], onRead?: () => void) {
  const calls: UvRect[][] = [];
  const reader: RegionReader = {
    async read(_r, _s, rects) {
      calls.push(rects.map((r) => [...r] as UvRect));
      onRead?.();
      return rects.map((_, i) => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(greys[i] ?? 0));
    },
    dispose() {},
  };
  return { reader, calls };
}
const frame = (h: ReturnType<typeof createDetailBackdropDimPass>) => h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);

describe("#84 card probe rect maths", () => {
  it("projects centre ± radius (u scaled by aspect), clamps, rejects junk", () => {
    const r = cardProbeRect([0.5, 0.5], 0.1, 2)!;
    assert.deepEqual(r.map((v) => +v.toFixed(6)), [0.45, 0.4, 0.55, 0.6]);
    assert.deepEqual(cardProbeRect([0.02, 0.98], 0.1, 1)!.map((v) => +v.toFixed(6)), [0, 0.88, 0.12, 1]);
    assert.equal(cardProbeRect(null, 0.1, 1), null);
    assert.equal(cardProbeRect([0.5, 0.5], 0, 1), null);
    assert.equal(cardProbeRect([0.5, 0.5], NaN, 1), null);
    assert.equal(cardProbeRect([NaN, 0.5], 0.1, 1), null);
    assert.equal(cardProbeRect([0.5, 0.5], 0.1, 0), null);
    assert.equal(cardProbeRect([1.5, 0.5], 0.1, 1), null, "fully off-canvas");
    assert.equal(METER_SLOTS, 3);
  });
});

describe("#84 detail dim — focused card metered on its own", () => {
  it("no panel open: probe alone measures the card; frame untouched (strength 0, no dim rects)", async () => {
    let t = 0;
    const { reader, calls } = recReader([10]);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    assert.equal(h.pass.enabled, false);
    h.setCardProbe(true);
    h.setHole(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    assert.equal(h.pass.enabled, true, "kept alive only to meter");
    assert.equal(h.strength, 0);
    frame(h);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.length, 1, "probe is the only slot");
    const c = h.contrast.card!;
    assert.ok(c, "card reading present");
    assert.ok(c.stats.mean > 0 && c.stats.mean < 0.01, `dark card mean ${c.stats.mean}`);
    assert.deepEqual(h.contrast.perRect, [], "no panel slots leak into perRect");
    assert.equal(h.contrast.source, "static");
    assert.equal(h.strength, 0, "probe never dims");
    assert.equal((h.pass.uniforms as { rectCount: { value: number } }).rectCount.value, 0);
    h.dispose();
    assert.equal(h.contrast.card, null);
  });

  it("panel + probe: probe is the last slot; panel plans read only panel slots", async () => {
    let t = 0;
    const { reader, calls } = recReader([230, 10]);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    h.setRects([chart], vp, { reducedMotion: true });
    h.setContrastTarget({ textRgb: [0.95, 0.95, 0.95] });
    h.setHole(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    frame(h);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(calls[0]!.length, 2);
    assert.equal(h.contrast.perRect.length, 1);
    assert.ok(h.contrast.perRect[0]!.mean > 0.5, "bright nebula behind Charts");
    assert.equal(h.contrast.source, "measured");
    assert.ok(h.contrast.card!.stats.mean < 0.01, "card read separately (dark)");
    assert.ok(h.strength > 0, "chart still dims from its own reading");
    h.dispose();
  });

  it("drifting card does not re-key every frame; refresh at the meter interval", async () => {
    let t = 0;
    const { reader, calls } = recReader([10]);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    const c = cam();
    for (let f = 0; f < 20; f++) {
      t = f * 16;
      h.setHole(new THREE.Vector3(f * 0.004, 0, 0), c, 0.1);
      frame(h);
      await flush();
      h.tick(16);
    }
    assert.equal(calls.length, 1, `20 frames (${t} ms) < ${METER_INTERVAL_MS} ms → one read`);
    assert.ok(h.contrast.card, "previous reading still valid while centre stays inside it");
    t = METER_INTERVAL_MS + 1;
    h.setHole(new THREE.Vector3(0.1, 0, 0), c, 0.1);
    frame(h);
    await flush();
    assert.equal(calls.length, 2, "refreshed after the interval");
    assert.ok(calls[1]![0]![0] > calls[0]![0]![0], "refreshed rect follows the card");
    h.dispose();
  });

  it("focus moves to another card → immediate read; old card's reading never reported for it", async () => {
    let t = 0;
    const { reader, calls } = recReader([10]);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    const c = cam();
    h.setHole(new THREE.Vector3(0, 0, 0), c, 0.1);
    frame(h);
    await flush();
    t = 16;
    h.setHole(new THREE.Vector3(3, 0, 0), c, 0.1);
    h.tick(16);
    assert.equal(h.contrast.card, null, "reading belonged to the previous card");
    frame(h);
    await flush();
    h.tick(16);
    assert.equal(calls.length, 2, "re-metered at once, not after the interval");
    assert.ok(h.contrast.card);
    h.dispose();
  });

  it("probe off / focus cleared / tab hidden → no reads, no card", async () => {
    let t = 0;
    const { reader, calls } = recReader([10]);
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setHole(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    assert.equal(h.pass.enabled, false, "off by default — no extra readback cost");
    frame(h);
    await flush();
    assert.equal(calls.length, 0);
    h.setCardProbe(true);
    h.setHidden(true);
    assert.equal(h.pass.enabled, false);
    h.setHidden(false);
    h.setHole(null, cam(), null);
    assert.equal(h.pass.enabled, false);
    frame(h);
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(h.contrast.card, null);
    assert.equal(h.contrast.cardProbe, true);
    h.dispose();
  });

  it("slow reads widen the #80 back-off and the probe refresh follows it", async () => {
    let t = 0;
    const { reader, calls } = recReader([10], () => {
      t += METER_SLOW_READ_MS + 10; // real (injected) begin→resolve latency
    });
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    const c = cam();
    h.setHole(new THREE.Vector3(0, 0, 0), c, 0.1);
    frame(h);
    await flush();
    const iv = h.contrast.backoff.intervalMs;
    assert.equal(iv, METER_INTERVAL_MS * 2);
    const t0 = 0;
    t = t0 + METER_INTERVAL_MS + 5;
    h.setHole(new THREE.Vector3(0.05, 0, 0), c, 0.1);
    frame(h);
    await flush();
    assert.equal(calls.length, 1, "nominal interval passed but back-off holds the probe");
    t = t0 + iv + 5;
    frame(h);
    await flush();
    assert.equal(calls.length, 2);
    h.dispose();
  });
});

describe("#84 key lift + badge use the card reading", () => {
  const dark = { mean: 0.004, p90: 0.006, max: 0.01, samples: 64 };
  const bright = { mean: 0.4, p90: 0.6, max: 0.8, samples: 64 };
  const rect: UvRect = [0.4, 0.4, 0.6, 0.6];
  it("liftBackdrop prefers the card's own rect, falls back to the panel, else null", () => {
    assert.deepEqual(liftBackdrop({ perRect: [bright], card: { stats: dark, rect, atMs: 0 } }, [rect], [0.5, 0.5]), {
      stats: dark,
      source: "card",
    });
    assert.deepEqual(liftBackdrop({ perRect: [bright], card: null }, [rect], [0.5, 0.5]), { stats: bright, source: "panel" });
    assert.equal(liftBackdrop({ perRect: [], card: null }, [], [0.5, 0.5]), null);
    assert.equal(liftBackdrop(null, [rect], [0.5, 0.5]), null);
    assert.equal(
      liftBackdrop({ perRect: [], card: { stats: { ...dark, mean: NaN }, rect, atMs: 0 } }, [], [0.5, 0.5]),
      null,
      "junk card reading is not used",
    );
  });

  it("no panel behind the card: probe reading drives a real lift (source card)", async () => {
    let t = 0;
    const { reader } = recReader([10]);
    const dim = createDetailBackdropDimPass({ reader, now: () => t });
    const lift = createSceneKeyLiftPass();
    const c = cam();
    const pos = new THREE.Vector3(0, 0, 0);
    dim.setCardProbe(true);
    dim.setHole(pos, c, 0.1);
    lift.setFocus(pos, c, 0.1);
    frame(dim);
    await flush();
    t = 16;
    dim.tick(16);
    const b = liftBackdrop(dim.contrast, dim.rects, lift.focusUv);
    assert.equal(b!.source, "card");
    lift.setBackdrop(b!.stats, { reducedMotion: true, source: b!.source });
    lift.tick(16);
    assert.equal(lift.report.source, "measured");
    assert.equal(lift.report.backdropSource, "card");
    assert.ok(lift.report.gain > 0 && lift.report.gain <= KEY_LIFT_MAX);
    const badge = formatMeterBadge(dim.contrast, lift.report);
    assert.match(badge.text, /card mean 0\.00 p90 0\.00/);
    assert.match(badge.text, /key \+0\.35 \(card\)$/);
    dim.dispose();
    lift.dispose();
  });

  it("badge says 'card no reading' when the probe is on but nothing was read", () => {
    const b = formatMeterBadge({
      source: "static",
      backdropLum: null,
      lastError: null,
      reads: 0,
      backoff: { multiplier: 1, intervalMs: METER_INTERVAL_MS, lastLatencyMs: null, reason: null },
      cardProbe: true,
      card: null,
    });
    assert.match(b.text, /card no reading/);
  });
});
