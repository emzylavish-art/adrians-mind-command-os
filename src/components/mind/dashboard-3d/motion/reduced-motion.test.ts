import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  motionScale,
  prefersReducedMotion,
  shouldScheduleUniverseFrame,
  shouldSoftSyncScene,
  subscribePrefersReducedMotion,
  universeMotionSignature,
} from "./reduced-motion.ts";

describe("reduced-motion", () => {
  it("prefersReducedMotion reads matchMedia", () => {
    assert.equal(
      prefersReducedMotion(() => ({ matches: true })),
      true,
    );
    assert.equal(
      prefersReducedMotion(() => ({ matches: false })),
      false,
    );
  });

  it("motionScale zeros when reduced", () => {
    assert.equal(motionScale(true), 0);
    assert.equal(motionScale(false), 1);
    assert.equal(motionScale(false, 0.5), 0.5);
    assert.equal(motionScale(false, 2), 1);
  });

  it("subscribePrefersReducedMotion reports the current match and later changes", () => {
    const seen: boolean[] = [];
    const box: { listener: (() => void) | null } = { listener: null };
    const query = { matches: false };
    const stop = subscribePrefersReducedMotion(
      (matches) => seen.push(matches),
      () => ({
        get matches() {
          return query.matches;
        },
        addEventListener(_type: string, fn: () => void) {
          box.listener = fn;
        },
        removeEventListener() {
          box.listener = null;
        },
      }),
    );
    assert.deepEqual(seen, [false]);
    query.matches = true;
    box.listener?.();
    assert.deepEqual(seen, [false, true]);
    stop();
    assert.equal(box.listener, null);
  });

  it("subscribePrefersReducedMotion stays false without matchMedia", () => {
    const seen: boolean[] = [];
    const stop = subscribePrefersReducedMotion((matches) => seen.push(matches), undefined);
    assert.deepEqual(seen, [false]);
    stop();
  });

  it("shouldScheduleUniverseFrame parks a settled reduced-motion scene", () => {
    const settled = {
      reducedMotion: true,
      rigSettled: true,
      interacting: false,
      dirty: false,
      documentHidden: false,
      contextLost: false,
    };
    assert.equal(shouldScheduleUniverseFrame(settled), false);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, dirty: true }), true);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, interacting: true }), true);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, rigSettled: false }), true);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, documentHidden: true }), false);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, contextLost: true }), true);
    assert.equal(shouldScheduleUniverseFrame({ ...settled, reducedMotion: false }), true);
  });

  it("shouldSoftSyncScene skips the 5s rebuild while reduced", () => {
    assert.equal(shouldSoftSyncScene(true, 6000), false);
    assert.equal(shouldSoftSyncScene(false, 6000), true);
    assert.equal(shouldSoftSyncScene(false, 5000), false);
    assert.equal(shouldSoftSyncScene(false, Number.NaN), false);
  });

  it("universeMotionSignature ignores identical content", () => {
    const input = {
      bots: [{ id: "logic", health: "healthy", reason: "lock" }],
      commitShas: ["abc"],
      feedIds: ["f1"],
      pageCount: 2,
      edgeCount: 1,
      projectKey: "logic:healthy:1",
    };
    assert.equal(universeMotionSignature(input), universeMotionSignature({ ...input, bots: [...input.bots] }));
    assert.notEqual(
      universeMotionSignature(input),
      universeMotionSignature({ ...input, bots: [{ id: "logic", health: "blocked", reason: "lock" }] }),
    );
  });
});
