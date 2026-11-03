import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOOM_BY_TONE } from "./bloom-tuning.ts";
import { EXPOSURE_BY_TONE, EXPOSURE_EASE_MS, createExposureRide } from "./exposure-ride.ts";

/**
 * HACKER (light cycle, Nov 1 2026): universe-scene calls setTarget() EVERY
 * frame before tick(). retarget() used to reset the ease clock unconditionally,
 * so the 400 ms ride restarted from the current value each frame and only ever
 * advanced smoothstep(16.7/400) ≈ 0.5% per frame — a multi-second crawl that
 * never actually lands on the health exposure.
 */
describe("exposure-ride per-frame retarget (hacker)", () => {
  it("same target every frame still lands within the ease window", () => {
    const ride = createExposureRide({ tone: "idle" });
    const frame = 1000 / 60;
    let elapsed = 0;
    while (elapsed < EXPOSURE_EASE_MS + frame * 2) {
      ride.setTarget({ tone: "blocked" });
      ride.tick(frame);
      elapsed += frame;
    }
    assert.equal(ride.exposure, EXPOSURE_BY_TONE.blocked);
    assert.equal(ride.bloomThreshold, BLOOM_BY_TONE.blocked.threshold);
  });

  it("an unchanged setTarget mid-ease does not restart the clock", () => {
    const ride = createExposureRide({ tone: "idle" });
    ride.setTarget({ tone: "healthy" });
    ride.tick(EXPOSURE_EASE_MS / 2);
    const mid = ride.exposure;
    ride.setTarget({ tone: "healthy" });
    ride.tick(EXPOSURE_EASE_MS / 2);
    assert.ok(mid > EXPOSURE_BY_TONE.idle && mid < EXPOSURE_BY_TONE.healthy);
    assert.equal(ride.exposure, EXPOSURE_BY_TONE.healthy);
  });

  it("a real change mid-ease still retargets from the current value", () => {
    const ride = createExposureRide({ tone: "idle" });
    ride.setTarget({ tone: "healthy" });
    ride.tick(EXPOSURE_EASE_MS / 2);
    const mid = ride.exposure;
    ride.setTarget({ tone: "blocked" });
    ride.tick(1);
    assert.ok(Math.abs(ride.exposure - mid) < 0.01, "no pop on retarget");
    ride.tick(EXPOSURE_EASE_MS);
    assert.equal(ride.exposure, EXPOSURE_BY_TONE.blocked);
  });
});
