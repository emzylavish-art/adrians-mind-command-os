import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_DROP_FRAME_MS, METER_MAX_AGE_MS, createBackdropMeter } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass } from "./detail-backdrop-dim.ts";
import type { RegionReader } from "./backdrop-meter.ts";

const st = { mean: 0.2, p90: 0.3, max: 0.4, samples: 64 };

/**
 * Hacker pass (cycle after #80): a readback in flight when the tab goes hidden
 * (or the page otherwise stops rendering) was billed as GPU cost — the hidden
 * time counted as readback latency ("slow-readback"), the resume frame as a
 * "frame-drop", or the never-polled read as "readback-timeout" — widening the
 * meter interval on a device that is not slow at all. A suspended read must be
 * excused: surfaced on lastError, never a back-off.
 */
describe("hacker: tab hidden mid-readback is not readback cost", () => {
  it("resolve after a suspend does not widen the back-off", () => {
    const m = createBackdropMeter();
    const t = m.begin(1000, "k");
    m.suspend();
    m.resolve(t, [st], 1000 + 30_000); // read landed after a 30 s hidden tab
    assert.equal(m.backoff.multiplier, 1);
    assert.equal(m.backoff.reason, null);
    assert.equal(m.backoff.lastLatencyMs, null, "hidden time is not a latency");
    assert.equal(m.lastError, "readback-suspended");
    assert.equal(m.measurementFor("k", 31_000), null, "30 s-old backdrop is never fresh");
  });
  it("a suspended read that never resolves times out without back-off", () => {
    const m = createBackdropMeter();
    m.begin(1000, "k");
    m.suspend();
    assert.equal(m.due(1000 + METER_MAX_AGE_MS + 1, "k"), true);
    assert.equal(m.backoff.multiplier, 1);
    assert.equal(m.lastError, "readback-suspended");
    assert.equal(m.inFlight, false);
  });
  it("the long resume frame during a suspended read is not a frame drop", () => {
    const m = createBackdropMeter();
    const t = m.begin(1000, "k");
    m.suspend();
    m.noteFrame(METER_DROP_FRAME_MS * 4);
    m.resolve(t, [st], 1005);
    assert.equal(m.backoff.multiplier, 1);
  });
  it("unsuspended slow reads still back off (guard intact)", () => {
    const m = createBackdropMeter();
    const t = m.begin(0, "k");
    m.resolve(t, [st], 80);
    assert.equal(m.backoff.multiplier, 2);
    assert.equal(m.backoff.reason, "slow-readback");
  });
  it("suspend with nothing in flight is a no-op", () => {
    const m = createBackdropMeter();
    m.suspend();
    assert.equal(m.lastError, null);
    assert.equal(m.inFlight, false);
  });
});

describe("hacker: dim pass excuses reads that resolve while the document is hidden", () => {
  it("document.hidden at resolve time → no back-off (real wiring never calls setHidden(true): the loop pauses first)", async () => {
    let clock = 0;
    const pendingRead: { resolve: ((b: Uint8Array[]) => void) | null } = { resolve: null };
    const reader: RegionReader = {
      read: () => new Promise<Uint8Array[]>((r) => (pendingRead.resolve = r)),
      dispose: () => {},
    };
    const doc = { hidden: false };
    const g = globalThis as { document?: unknown };
    const prevDoc = g.document;
    g.document = doc;
    try {
      const dim = createDetailBackdropDimPass({ reader, now: () => clock });
      dim.setRects([{ left: 10, top: 10, width: 200, height: 100 }], { width: 800, height: 600 }, { reducedMotion: true });
      dim.setContrastTarget({ textRgb: [1, 1, 1] });
      const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
      const rt = { texture: new THREE.Texture(), width: 800, height: 600 };
      dim.pass.render(fakeRenderer, {} as never, rt as never, 0, false);
      assert.ok(pendingRead.resolve, "read started");
      doc.hidden = true; // user switched tabs; rAF stops, read polls on throttled timers
      clock += 20_000;
      pendingRead.resolve!([new Uint8Array(256).fill(200)]);
      await new Promise((r) => setTimeout(r, 0));
      doc.hidden = false;
      assert.equal(dim.contrast.backoff.multiplier, 1);
      assert.equal(dim.contrast.backoff.reason, null);
      dim.dispose();
    } finally {
      g.document = prevDoc;
    }
  });
});

describe("hacker: visibilitychange excuses a read that only resolves after resume", () => {
  it("hide → (no frames) → resume → late resolve: no back-off, listener removed on dispose", async () => {
    let clock = 0;
    const pendingRead: { resolve: ((b: Uint8Array[]) => void) | null } = { resolve: null };
    const reader: RegionReader = {
      read: () => new Promise<Uint8Array[]>((r) => (pendingRead.resolve = r)),
      dispose: () => {},
    };
    const listeners = new Set<() => void>();
    const doc = {
      hidden: false,
      addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
    };
    const g = globalThis as { document?: unknown };
    const prevDoc = g.document;
    g.document = doc;
    try {
      const dim = createDetailBackdropDimPass({ reader, now: () => clock });
      assert.equal(listeners.size, 1);
      dim.setRects([{ left: 10, top: 10, width: 200, height: 100 }], { width: 800, height: 600 }, { reducedMotion: true });
      dim.setContrastTarget({ textRgb: [1, 1, 1] });
      const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
      dim.pass.render(fakeRenderer, {} as never, { texture: new THREE.Texture(), width: 800, height: 600 } as never, 0, false);
      doc.hidden = true;
      listeners.forEach((fn) => fn());
      clock += 15_000;
      doc.hidden = false;
      listeners.forEach((fn) => fn());
      dim.tick(100); // clamped resume frame while the read is still pending
      pendingRead.resolve!([new Uint8Array(256).fill(200)]);
      await new Promise((r) => setTimeout(r, 0));
      dim.tick(16);
      assert.equal(dim.contrast.backoff.multiplier, 1);
      assert.equal(dim.contrast.lastError, "readback-suspended");
      assert.equal(dim.contrast.source, "static", "pre-gap frame never counts as measured");
      dim.dispose();
      assert.equal(listeners.size, 0, "no leaked visibility listener");
    } finally {
      g.document = prevDoc;
    }
  });
});
