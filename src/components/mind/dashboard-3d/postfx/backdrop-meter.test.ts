import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  METER_EDGE,
  METER_INTERVAL_MS,
  METER_MAX_AGE_MS,
  createBackdropMeter,
  createRegionReader,
  measureLuminance,
  rectsKey,
} from "./backdrop-meter.ts";

function block(px: (i: number) => [number, number, number], n = METER_EDGE * METER_EDGE): Uint8Array {
  const a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) a.set([...px(i), 255], i * 4);
  return a;
}
const stats = { mean: 0.5, p90: 0.6, max: 0.7, samples: 64 };

describe("backdrop meter (#68) — measured luminance, honest when absent", () => {
  it("measureLuminance: mean / p90 bright tail / max; junk → null", () => {
    // 90% black, 10% white → p90 catches the bright tail (stars/nebula under text).
    const s = measureLuminance(block((i) => (i % 10 === 0 ? [255, 255, 255] : [0, 0, 0])), 8, 8)!;
    assert.equal(s.samples, 64);
    assert.equal(s.max, 1);
    assert.ok(s.mean > 0.09 && s.mean < 0.12);
    const flat = measureLuminance(block(() => [128, 128, 128]), 8, 8)!;
    assert.ok(Math.abs(flat.p90 - flat.mean) < 1e-9);
    assert.equal(measureLuminance(null, 8, 8), null);
    assert.equal(measureLuminance(new Uint8Array(4), 8, 8), null);
    assert.equal(measureLuminance(block(() => [0, 0, 0]), 0, 8), null);
    const f = measureLuminance(new Float32Array([1, 1, 1, 1]), 1, 1, { normalized: true })!;
    assert.equal(f.max, 1);
  });

  it("rectsKey ignores sub-pixel jitter, changes on real moves", () => {
    assert.equal(rectsKey([[0.1, 0.1, 0.5, 0.5]]), rectsKey([[0.1001, 0.1, 0.5, 0.5]]));
    assert.notEqual(rectsKey([[0.1, 0.1, 0.5, 0.5]]), rectsKey([[0.2, 0.1, 0.5, 0.5]]));
  });

  it("schedules every interval, no overlap, fresh-only measurements", () => {
    const m = createBackdropMeter();
    assert.equal(m.due(0, "k"), true);
    const t = m.begin(0, "k");
    assert.equal(m.inFlight, true);
    assert.equal(m.due(10, "k"), false, "no overlapping reads");
    assert.equal(m.measurementFor("k", 10), null, "nothing until a real read lands");
    m.resolve(t, [stats], 20);
    assert.equal(m.measurementFor("k", 30)!.stats.p90, 0.6);
    assert.equal(m.measurementFor("other", 30), null, "other layout never borrows a reading");
    assert.equal(m.due(100, "k"), false);
    assert.equal(m.due(METER_INTERVAL_MS, "k"), true);
    assert.equal(m.measurementFor("k", 20 + METER_MAX_AGE_MS + 1), null, "stale → static fallback");
    assert.equal(m.due(1, "k2"), true, "layout change reads immediately");
  });

  it("hidden → no reads; reduced motion → one read per layout", () => {
    const m = createBackdropMeter();
    assert.equal(m.due(0, "k", { hidden: true }), false);
    const t = m.begin(0, "k");
    m.resolve(t, [stats], 1);
    assert.equal(m.due(5000, "k", { reducedMotion: true }) && m.measurementFor("k", 5000) === null, false);
    assert.equal(m.due(600, "k", { reducedMotion: true }), false);
    assert.equal(m.due(600, "k-moved", { reducedMotion: true }), true);
  });

  it("failures and empty reads surface lastError; superseded tokens ignored; hung read times out", () => {
    const m = createBackdropMeter();
    const t1 = m.begin(0, "k");
    m.fail(t1, new Error("context lost"));
    assert.match(m.lastError!, /context lost/);
    assert.equal(m.measurementFor("k", 1), null);
    const t2 = m.begin(1, "k");
    m.resolve(t2, [null], 2);
    assert.equal(m.lastError, "empty-readback");
    const t3 = m.begin(3, "k");
    m.reset();
    m.resolve(t3, [stats], 4);
    assert.equal(m.measurementFor("k", 5), null, "reset drops in-flight result");
    m.begin(10, "k");
    assert.equal(m.due(10 + METER_MAX_AGE_MS - 1, "k"), false);
    assert.equal(m.due(10 + METER_MAX_AGE_MS + 1, "k"), true, "hung readback never wedges the meter");
    assert.equal(m.lastError, "readback-timeout");
  });

  it("region reader: restores render target, unbinds source, async + sync paths, dispose rejects", async () => {
    const reader = createRegionReader(2);
    const prev = { id: "composer-rt" };
    let current: unknown = prev;
    const set: unknown[] = [];
    let renders = 0;
    const sync = {
      getRenderTarget: () => current,
      setRenderTarget: (t: unknown) => {
        set.push(t);
        current = t;
      },
      render: () => {
        renders++;
      },
      readRenderTargetPixels: (_rt: unknown, _x: number, _y: number, w: number, h: number, buf: Uint8Array) => {
        buf.fill(200, 0, w * h * 4);
      },
    };
    const src = new THREE.Texture();
    const out = await reader.read(sync as never, src, [
      [0, 0, 0.5, 0.5],
      [0.5, 0.5, 1, 1],
    ]);
    assert.equal(out.length, 2);
    assert.equal(renders, 2);
    assert.equal(out[0]![0], 200);
    assert.equal(current, prev, "composer render target restored");
    const asyncR = { ...sync, readRenderTargetPixelsAsync: async (_rt: unknown, _x: number, _y: number, w: number, h: number, buf: Uint8Array) => buf.fill(7, 0, w * h * 4) };
    const out2 = await reader.read(asyncR as never, src, [[0, 0, 1, 1]]);
    assert.equal(out2[0]![5], 7);
    const throwing = { ...sync, render: () => { throw new Error("gl boom"); } };
    await assert.rejects(reader.read(throwing as never, src, [[0, 0, 1, 1]]), /gl boom/);
    assert.equal(current, prev, "restored even when the draw throws");
    reader.dispose();
    await assert.rejects(reader.read(sync as never, src, [[0, 0, 1, 1]]), /meter-disposed/);
    assert.doesNotThrow(() => reader.dispose());
  });
});
