/**
 * Motion c27 — reduced-motion guard + settle gate + hashMotionLaneSnapshot.
 * HACKER (new angle vs c1–c26):
 *  - unstable plain-object key order must not change the hash
 *  - length-/prefix-only hashes collide (different payloads → same digest)
 *  - matchMedia missing (SSR) + legacy MediaQueryList addListener-only
 *  - prefers-reduced-motion flapping during a settle window must not thrash
 *    rebuild/mount decisions
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createReducedMotionGuard,
  hashMotionLaneSnapshot,
  observeReducedMotion,
  shouldMountHeavy,
  shouldRebuildScene,
  snapRigProgress,
  stepReducedMotionSettle,
} from "./reduced-motion-guard.ts";

describe("hacker c27 — hashMotionLaneSnapshot stability", () => {
  it("plain objects with different key insertion order hash identically", () => {
    const a: Record<string, unknown> = {};
    a.z = 1;
    a.a = 2;
    a.m = { y: 9, x: 8 };
    const b: Record<string, unknown> = {};
    b.a = 2;
    b.m = { x: 8, y: 9 };
    b.z = 1;
    assert.equal(
      hashMotionLaneSnapshot(a),
      hashMotionLaneSnapshot(b),
      "key order must be canonicalized",
    );
  });

  it("arrays preserve order; objects inside arrays are still key-sorted", () => {
    assert.notEqual(
      hashMotionLaneSnapshot([{ b: 1, a: 2 }, { a: 2, b: 1 }]),
      hashMotionLaneSnapshot([{ a: 2, b: 1 }]),
    );
    assert.equal(
      hashMotionLaneSnapshot([{ b: 1, a: 2 }]),
      hashMotionLaneSnapshot([{ a: 2, b: 1 }]),
    );
  });

  it("distinct payloads never collide on length-alike shapes", () => {
    // A naive hash of JSON.stringify(x).length collides these two.
    const left = { commits: ["aaaa", "bbbb"], bots: 2 };
    const right = { commits: ["aaab", "bbba"], bots: 2 };
    assert.equal(JSON.stringify(left).length, JSON.stringify(right).length);
    assert.notEqual(
      hashMotionLaneSnapshot(left),
      hashMotionLaneSnapshot(right),
      "content digest required — length alone collides",
    );
  });

  it("tolerates null / undefined / NaN / ±0 / cycles without throw", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    assert.equal(typeof hashMotionLaneSnapshot(null), "string");
    assert.equal(typeof hashMotionLaneSnapshot(undefined), "string");
    assert.equal(typeof hashMotionLaneSnapshot(Number.NaN), "string");
    assert.equal(hashMotionLaneSnapshot(0), hashMotionLaneSnapshot(-0));
    assert.equal(typeof hashMotionLaneSnapshot(cyclic), "string");
    assert.notEqual(hashMotionLaneSnapshot(null), hashMotionLaneSnapshot(undefined));
  });
});

describe("hacker c27 — observeReducedMotion host gaps", () => {
  it("matchMedia missing (SSR) → matches=false and disconnect is a no-op", () => {
    const sub = observeReducedMotion(() => {}, null);
    assert.equal(sub.matches, false);
    assert.doesNotThrow(() => sub.disconnect());
  });

  it("legacy MediaQueryList with addListener only still notifies and cleans up", () => {
    const listeners: Array<(ev: { matches: boolean }) => void> = [];
    let matches = false;
    const mql = {
      get matches() {
        return matches;
      },
      addListener(fn: (ev: { matches: boolean }) => void) {
        listeners.push(fn);
      },
      removeListener(fn: (ev: { matches: boolean }) => void) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      // no addEventListener / removeEventListener
    };
    const seen: boolean[] = [];
    const sub = observeReducedMotion((v) => seen.push(v), () => mql as MediaQueryList);
    assert.equal(sub.matches, false);
    matches = true;
    for (const fn of [...listeners]) fn({ matches: true });
    assert.deepEqual(seen, [true]);
    sub.disconnect();
    matches = false;
    for (const fn of [...listeners]) fn({ matches: false });
    assert.deepEqual(seen, [true], "after disconnect legacy listener must be removed");
  });

  it("matchMedia that throws → safe false, no throw to caller", () => {
    assert.doesNotThrow(() => {
      const sub = observeReducedMotion(() => {}, () => {
        throw new Error("denied");
      });
      assert.equal(sub.matches, false);
      sub.disconnect();
    });
  });
});

describe("hacker c27 — settle gate + rapid RM flap", () => {
  it("under reduced, rebuild only when data hash changes", () => {
    const g = createReducedMotionGuard();
    const h1 = hashMotionLaneSnapshot({ n: 1 });
    const h2 = hashMotionLaneSnapshot({ n: 2 });
    assert.equal(shouldRebuildScene(g, h1, true, 1000), true); // first
    assert.equal(shouldRebuildScene(g, h1, true, 1100), false); // same hash
    assert.equal(shouldRebuildScene(g, h2, true, 1200), true); // changed
    assert.equal(shouldRebuildScene(g, h2, true, 1300), false);
  });

  it("heavy mount allowed once under reduced, then blocked", () => {
    const g = createReducedMotionGuard();
    assert.equal(shouldMountHeavy(g, true), true);
    assert.equal(shouldMountHeavy(g, true), false);
    assert.equal(shouldMountHeavy(g, true), false);
    // motion-on still allows (Dashboard may remount freely when animating)
    const g2 = createReducedMotionGuard();
    assert.equal(shouldMountHeavy(g2, false), true);
    assert.equal(shouldMountHeavy(g2, false), true);
  });

  it("snapRigProgress forces t=1 under reduced; leaves t when motion on", () => {
    const rig = { t: 0.35 };
    snapRigProgress(rig, true);
    assert.equal(rig.t, 1);
    const rig2 = { t: 0.35 };
    snapRigProgress(rig2, false);
    assert.equal(rig2.t, 0.35);
    snapRigProgress(null, true); // hostile
    snapRigProgress({ t: Number.NaN }, true);
    assert.equal(({ t: Number.NaN, ...{} } as { t: number }).t, Number.NaN); // sanity
    const bad = { t: Number.NaN };
    snapRigProgress(bad, true);
    assert.equal(bad.t, 1);
  });

  it("rapid RM true/false flap during settle does not re-arm heavy mount or rebuild", () => {
    const g = createReducedMotionGuard({ settleMs: 500 });
    const h = hashMotionLaneSnapshot({ bots: ["a"] });
    // Enter reduced, take first rebuild + heavy
    assert.equal(shouldRebuildScene(g, h, true, 0), true);
    assert.equal(shouldMountHeavy(g, true), true);
    // Flap: motion on briefly then reduced again inside settle window
    stepReducedMotionSettle(g, false, 100);
    stepReducedMotionSettle(g, true, 150);
    stepReducedMotionSettle(g, false, 200);
    stepReducedMotionSettle(g, true, 250);
    // Same hash — must NOT rebuild; heavy must stay spent
    assert.equal(shouldRebuildScene(g, h, true, 300), false);
    assert.equal(shouldMountHeavy(g, true), false);
    // After settle expires + hash change → rebuild ok; heavy still spent
    assert.equal(shouldRebuildScene(g, hashMotionLaneSnapshot({ bots: ["b"] }), true, 1000), true);
    assert.equal(shouldMountHeavy(g, true), false);
  });
});
