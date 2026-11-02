/**
 * Hacker c23: the scene's 5s sync disposed + rebuilt every comet (GPU buffers, materials,
 * shader-program release) even when commits were unchanged; a new commit shifted every
 * index so all comets jumped orbit and relaunched; duplicate shas drew twin comets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  COMET_SHA_KEY_MAX,
  commitCometKeys,
  cometOrbitForSha,
  createCommitComets,
  syncCommitComets,
  type CommitCometsHandle,
} from "./commit-comets.ts";
import { createMotionClock } from "../motion/motion-clock.ts";
import {
  createCometLaunchSample,
  createCometLaunchState,
  reconcileCometLaunch,
  stepCometLaunchEase,
  type CometLaunchSample,
} from "../motion/comet-launch-ease.ts";

const C = (...shas: string[]) => shas.map((sha) => ({ sha, subject: sha }));

function countDisposes(h: CommitCometsHandle): () => number {
  let n = 0;
  h.group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.addEventListener("dispose", () => n++);
    (m.material as THREE.Material | undefined)?.addEventListener?.("dispose", () => n++);
  });
  return () => n;
}

function headOf(h: CommitCometsHandle, sha: string): THREE.Vector3 {
  const i = (h.shas ?? []).indexOf(sha);
  assert.ok(i >= 0, `comet for ${sha}`);
  const head = h.group.getObjectByName(`motion-comet-head-${i}`) as THREE.Points;
  const a = head.geometry.getAttribute("position");
  return new THREE.Vector3(a.getX(0), a.getY(0), a.getZ(0));
}

describe("hacker c23 — comet 5s rebuild churn", () => {
  it("old dispose+create path frees every GPU resource each sync (documents the break)", () => {
    const scene = new THREE.Scene();
    let h = createCommitComets(scene, C("a", "b", "c"), { max: 6 });
    const disposed = countDisposes(h);
    h.dispose();
    h = createCommitComets(scene, C("a", "b", "c"), { max: 6 });
    assert.equal(disposed(), 12, "3 comets × (line geo+mat, head geo+mat) freed for nothing");
    h.dispose();
  });

  it("syncCommitComets keeps the same handle (zero disposes) when commits are unchanged", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "b", "c"), { max: 6 });
    const disposed = countDisposes(h);
    // Fresh array objects each sync (as from JSON) must still match.
    for (let k = 0; k < 10; k++) {
      const next = syncCommitComets(scene, h, C("a", "b", "c"), { max: 6 });
      assert.equal(next, h);
    }
    // Dupes / blank shas that don't change the derived list: still no rebuild.
    assert.equal(syncCommitComets(scene, h, C("a", "a", "", "b", "c"), { max: 6 }), h);
    assert.equal(disposed(), 0);
    assert.equal(h.disposed, false);
    // Extra rows past max / dupes / blank shas that don't change the derived list: no rebuild.
    assert.equal(syncCommitComets(scene, h, C("a", "a", "", "b", "c", "d", "e", "f", "g"), { max: 6 }) === h, false, "list grew → rebuild");
    h.dispose();
  });

  it("rebuilds (and disposes prev) when the list, options, scene, or handle state changes", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "b"), { max: 6 });
    const h2 = syncCommitComets(scene, h, C("n", "a", "b"), { max: 6 });
    assert.notEqual(h2, h);
    assert.equal(h.disposed, true);
    assert.equal(scene.children.includes(h.group), false);
    assert.equal(h2.count, 3);
    const h3 = syncCommitComets(scene, h2, C("n", "a", "b"), { max: 6, segments: 12 });
    assert.notEqual(h3, h2, "options change → rebuild");
    const other = new THREE.Scene();
    const h4 = syncCommitComets(other, h3, C("n", "a", "b"), { max: 6, segments: 12 });
    assert.notEqual(h4, h3, "different scene → rebuild");
    h4.dispose();
    const h5 = syncCommitComets(other, h4, C("n", "a", "b"), { max: 6, segments: 12 });
    assert.notEqual(h5, h4, "disposed prev → rebuild");
    assert.equal(h5.disposed, false);
    const h6 = syncCommitComets(other, null, null, {});
    assert.equal(h6.count, 0);
    h5.dispose();
    h6.dispose();
  });

  it("duplicate shas draw one comet (first wins); mega-sha capped; bounded scan", () => {
    assert.deepEqual(commitCometKeys(C("a", "b", "a", "c", "b"), 6), ["a", "b", "c"]);
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "a", "b"), { max: 6 });
    assert.equal(h.count, 2);
    h.dispose();
    const mega = "f".repeat(1_000_000);
    const keys = commitCometKeys([{ sha: mega }], 6);
    assert.equal(keys[0]!.length, COMET_SHA_KEY_MAX);
    const dupes = Array.from({ length: 1_000_000 }, () => ({ sha: "x" }));
    const t0 = performance.now();
    assert.deepEqual(commitCometKeys(dupes, 6), ["x"]);
    assert.ok(performance.now() - t0 < 50, "1e6 duplicate rows must not walk the whole feed");
    assert.deepEqual(commitCometKeys([null, 7, { sha: 3 }, { sha: "" }, "s"] as never, 6), []);
    assert.deepEqual(commitCometKeys(C("a", "b"), 0), []);
    assert.deepEqual(commitCometKeys(C("a", "b"), Number.NaN), ["a", "b"]);
  });

  it("orbit is a function of the sha: prepending a commit leaves existing comets in place", () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const ca = createMotionClock();
    const cb = createMotionClock();
    const a = createCommitComets(sceneA, C("x1", "y2", "z3"), { clock: ca });
    const b = createCommitComets(sceneB, C("new9", "x1", "y2", "z3"), { clock: cb });
    for (let f = 0; f <= 30; f++) {
      a.update(10 + f / 60, false);
      b.update(10 + f / 60, false);
    }
    for (const sha of ["x1", "y2", "z3"]) {
      assert.ok(headOf(a, sha).distanceTo(headOf(b, sha)) < 1e-5, `${sha} kept its orbit`);
    }
    const o = cometOrbitForSha("x1");
    assert.deepEqual(o, cometOrbitForSha("x1"));
    for (const s of ["", "a", "f".repeat(5000), "0123456789abcdef0123456789abcdef01234567"]) {
      const p = cometOrbitForSha(s);
      assert.ok(p.speed >= 0.22 && p.speed <= 0.32 + 1e-9);
      assert.ok(p.incline >= 0.25 && p.incline <= 0.49 + 1e-9);
      assert.ok(p.phase >= 0 && p.phase < Math.PI * 2 && p.yaw >= 0 && p.yaw < Math.PI * 2);
    }
    assert.ok(Number.isFinite(cometOrbitForSha(undefined as never).speed));
    a.dispose();
    b.dispose();
  });
});

describe("hacker c23 — reconcile follows keys across a prepend", () => {
  const run = (st: ReturnType<typeof createCometLaunchState>, out: CometLaunchSample[], secs: number) => {
    for (let i = 0; i < Math.round(secs * 60); i++) stepCometLaunchEase(st, out, 1 / 60, false);
  };

  it("new commit prepended → only the new comet launches; landed ones stay lit", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, ["a", "b", "c", "d", "e", "f"], false);
    run(st, out, 2);
    assert.ok(out.slice(0, 6).every((s) => s.opacity === 1));
    const launched = reconcileCometLaunch(st, ["n", "a", "b", "c", "d", "e"], false);
    assert.equal(launched, 1, "only the new sha launches");
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.ok(out[0]!.opacity < 1, "new comet eases in");
    for (let i = 1; i < 6; i++) assert.equal(out[i]!.opacity, 1, `slot ${i} (shifted) stays lit — no blink`);
    assert.deepEqual(st.keys!.slice(0, 7), ["n", "a", "b", "c", "d", "e", null]);
  });

  it("in-flight comet that moved index keeps its progress", () => {
    const st = createCometLaunchState(8);
    const out = Array.from({ length: 8 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, ["a"], false, { stagger: 0 });
    run(st, out, 0.1);
    const mid = st.slots[0]!.amount;
    assert.ok(mid > 0 && mid < 1);
    reconcileCometLaunch(st, ["n", "a"], false, { stagger: 0 });
    assert.equal(st.slots[1]!.amount, mid);
    assert.equal(st.slots[1]!.live, true);
  });

  it("duplicate keys: second occurrence launches (no shared state), garbage slots stay finite", () => {
    const st = createCometLaunchState(6);
    const out = Array.from({ length: 6 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, ["a", "b"], true);
    st.slots[1]!.amount = Number.NaN;
    reconcileCometLaunch(st, ["b", "a", "a"], false);
    run(st, out, 2);
    for (const s of out) assert.ok(Number.isFinite(s.opacity) && Number.isFinite(s.scale));
    assert.equal(out[2]!.opacity, 1);
  });

  it("hand-built oversized state (past burst cap) still reconciles in O(m)", () => {
    const st = { slots: Array.from({ length: 5000 }, () => ({ amount: 0, delay: 0, live: false })) };
    const keys = Array.from({ length: 5000 }, (_, i) => `k${i}`);
    reconcileCometLaunch(st, keys, false);
    const t0 = performance.now();
    reconcileCometLaunch(st, ["new", ...keys.slice(0, 4999)], false);
    assert.ok(performance.now() - t0 < 100);
  });
});
