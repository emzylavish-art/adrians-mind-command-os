import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOOM_BY_TONE } from "./bloom-tuning.ts";
import {
  EXPOSURE_BY_TONE,
  EXPOSURE_EASE_MS,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  bloomThresholdFor,
  clampExposure,
  createExposureRide,
  exposureTargetFor,
  timeOfDayExposureScale,
} from "./exposure-ride.ts";

describe("exposure-ride (queue #12)", () => {
  it("clampExposure rejects NaN/Inf and stays in [MIN, MAX]", () => {
    assert.equal(clampExposure(Number.NaN), EXPOSURE_BY_TONE.idle);
    assert.equal(clampExposure(Number.POSITIVE_INFINITY), EXPOSURE_BY_TONE.idle);
    assert.equal(clampExposure(0), EXPOSURE_MIN);
    assert.equal(clampExposure(9), EXPOSURE_MAX);
  });

  it("missing / junk tone targets idle (neutral), never healthy green boost", () => {
    assert.equal(exposureTargetFor({}), EXPOSURE_BY_TONE.idle);
    assert.equal(exposureTargetFor({ tone: undefined }), EXPOSURE_BY_TONE.idle);
    assert.equal(exposureTargetFor({ tone: "nope" }), EXPOSURE_BY_TONE.idle);
    assert.equal(exposureTargetFor({ tone: Number.NaN }), EXPOSURE_BY_TONE.idle);
    assert.ok(exposureTargetFor({ tone: "healthy" }) > exposureTargetFor({ tone: "idle" }));
    assert.ok(exposureTargetFor({ tone: "blocked" }) < exposureTargetFor({ tone: "idle" }));
  });

  it("time-of-day scale dims night and lifts golden hour", () => {
    assert.ok(timeOfDayExposureScale(2) < 1);
    assert.ok(timeOfDayExposureScale(7) > 1);
    assert.equal(timeOfDayExposureScale(Number.NaN), 1);
  });

  it("bloomThresholdFor pairs with BLOOM_BY_TONE and normalizes junk", () => {
    assert.equal(bloomThresholdFor("blocked"), BLOOM_BY_TONE.blocked.threshold);
    assert.equal(bloomThresholdFor("???"), BLOOM_BY_TONE.idle.threshold);
  });

  it("eases toward a new tone over ~400ms and snaps under reduced-motion", () => {
    const ride = createExposureRide({ tone: "idle" });
    assert.equal(ride.exposure, EXPOSURE_BY_TONE.idle);
    ride.setTarget({ tone: "healthy" });
    assert.notEqual(ride.exposure, ride.targetExposure);
    ride.tick(EXPOSURE_EASE_MS / 2);
    assert.ok(ride.exposure > EXPOSURE_BY_TONE.idle && ride.exposure < EXPOSURE_BY_TONE.healthy);
    ride.tick(EXPOSURE_EASE_MS);
    assert.ok(Math.abs(ride.exposure - EXPOSURE_BY_TONE.healthy) < 1e-9);

    ride.setTarget({ tone: "blocked", reducedMotion: true });
    assert.equal(ride.exposure, exposureTargetFor({ tone: "blocked" }));
    assert.equal(ride.bloomThreshold, BLOOM_BY_TONE.blocked.threshold);
    ride.dispose();
  });

  it("apply writes exposure + bloom threshold; post-dispose is a no-op", () => {
    const ride = createExposureRide({ tone: "healthy" });
    const renderer = { toneMappingExposure: 1 };
    const bloom = { pass: { threshold: 0 } };
    ride.apply(renderer, bloom);
    assert.equal(renderer.toneMappingExposure, EXPOSURE_BY_TONE.healthy);
    assert.equal(bloom.pass.threshold, BLOOM_BY_TONE.healthy.threshold);
    ride.dispose();
    renderer.toneMappingExposure = 0;
    ride.setTarget({ tone: "blocked" });
    ride.tick(100);
    ride.apply(renderer, bloom);
    assert.equal(renderer.toneMappingExposure, 0, "disposed ride must not write");
  });
});
