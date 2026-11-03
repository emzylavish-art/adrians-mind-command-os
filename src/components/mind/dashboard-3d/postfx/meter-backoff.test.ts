import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  METER_DROP_FRAME_MS,
  METER_INTERVAL_MS,
  METER_MAX_AGE_MS,
  METER_MAX_BACKOFF,
  createBackdropMeter,
} from "./backdrop-meter.ts";

const st = { mean: 0.2, p90: 0.3, max: 0.4, samples: 64 };

describe("hacker pass (cycle after #79): clock skew never reads as fresh", () => {
  it("resolve with nowMs < sampledAt is rejected and surfaced", () => {
    const m = createBackdropMeter();
    const t = m.begin(1000, "k");
    m.resolve(t, [st], 900); // clock went backwards
    assert.equal(m.lastError, "clock-skew");
    assert.equal(m.measurementFor("k", 900), null);
  });
  it("a measurement is not fresh at a time before it was sampled", () => {
    const m = createBackdropMeter();
    const t = m.begin(1_000_000, "k");
    m.resolve(t, [st], 1_000_010);
    assert.ok(m.measurementFor("k", 1_000_020));
    // Mixed clocks (Date.now sample, performance.now read) used to be fresh forever.
    assert.equal(m.measurementFor("k", 5), null);
  });
  it("due re-arms when the clock jumps backwards instead of stalling", () => {
    const m = createBackdropMeter();
    const t = m.begin(1_000_000, "k");
    m.resolve(t, [st], 1_000_010);
    assert.equal(m.due(10, "k"), true);
  });
});

describe("#80 meter readback cost guard — real timings widen the interval", () => {
  it("starts nominal with no fabricated latency", () => {
    const b = createBackdropMeter().backoff;
    assert.deepEqual(b, { multiplier: 1, intervalMs: METER_INTERVAL_MS, lastLatencyMs: null, reason: null });
  });
  it("slow readbacks double the interval up to the cap; fast ones recover", () => {
    const m = createBackdropMeter();
    let now = 0;
    for (let i = 0; i < 6; i++) {
      const t = m.begin(now, "k");
      m.resolve(t, [st], now + 80); // 80 ms readback
      assert.equal(m.backoff.lastLatencyMs, 80);
      now += 10_000;
    }
    assert.equal(m.backoff.multiplier, METER_MAX_BACKOFF);
    assert.equal(m.backoff.reason, "slow-readback");
    assert.equal(m.backoff.intervalMs, METER_INTERVAL_MS * METER_MAX_BACKOFF);
    // Not due at the base interval any more.
    assert.equal(m.due(now - 10_000 + 80 + METER_INTERVAL_MS, "k"), false);
    for (let i = 0; i < 3; i++) {
      const t = m.begin(now, "k");
      m.resolve(t, [st], now + 5);
      now += 10_000;
    }
    assert.equal(m.backoff.multiplier, 1);
    assert.equal(m.backoff.reason, null);
  });
  it("a dropped frame during an in-flight read widens even if latency looked fine", () => {
    const m = createBackdropMeter();
    const t = m.begin(0, "k");
    m.noteFrame(METER_DROP_FRAME_MS + 5);
    m.resolve(t, [st], 10);
    assert.equal(m.backoff.multiplier, 2);
    assert.equal(m.backoff.reason, "frame-drop");
  });
  it("long frames with no read in flight are not blamed on the meter", () => {
    const m = createBackdropMeter();
    m.noteFrame(500);
    const t = m.begin(0, "k");
    m.resolve(t, [st], 10);
    assert.equal(m.backoff.multiplier, 1);
  });
  it("a timed-out readback widens with reason readback-timeout", () => {
    const m = createBackdropMeter();
    m.begin(0, "k");
    m.due(METER_MAX_AGE_MS + 1, "k");
    assert.equal(m.lastError, "readback-timeout");
    assert.equal(m.backoff.reason, "readback-timeout");
    assert.equal(m.backoff.multiplier, 2);
  });
  it("reset keeps the device back-off (layout change must not re-hammer a slow GPU)", () => {
    const m = createBackdropMeter();
    const t = m.begin(0, "k");
    m.resolve(t, [st], 100);
    m.reset();
    assert.equal(m.backoff.multiplier, 2);
  });
});
