import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METER_MAX_AGE_MS, createBackdropMeter, type LuminanceStats } from "./backdrop-meter.ts";

const stats: LuminanceStats = { mean: 0.5, p90: 0.6, max: 0.7, samples: 64 };

describe("backdrop meter — freshness is measured from the sampled frame (hacker pass)", () => {
  it("a slow readback does not extend freshness past METER_MAX_AGE_MS after sampling", () => {
    const m = createBackdropMeter();
    const t = m.begin(0, "k");
    m.resolve(t, [stats], 1900); // driver stall: landed 1.9 s after the frame was sampled
    const got = m.measurementFor("k", 0 + METER_MAX_AGE_MS + 500);
    assert.equal(got, null, "backdrop sampled 2.5 s ago must not count as fresh");
    assert.equal(m.measurementFor("k", 1950)!.atMs, 0, "atMs is the sample time");
  });

  it("a readback that lands after max age is rejected and surfaced, never published", () => {
    const m = createBackdropMeter();
    const t = m.begin(0, "k");
    m.resolve(t, [stats], METER_MAX_AGE_MS + 1);
    assert.equal(m.measurementFor("k", METER_MAX_AGE_MS + 1), null);
    assert.equal(m.lastError, "stale-readback");
  });

  it("reset clears a previous failure so a reconfigured meter reports honestly", () => {
    const m = createBackdropMeter();
    m.fail(m.begin(0, "k"), new Error("context lost"));
    assert.match(m.lastError!, /context lost/);
    m.reset();
    assert.equal(m.lastError, null);
  });
});
