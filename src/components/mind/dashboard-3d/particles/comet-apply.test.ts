/** c24: applyCometLaunchSamples matches the scene's c22 per-comet loop with zero tree walks. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { applyCometLaunchSamples, createCommitComets, type CommitCometsHandle } from "./commit-comets.ts";
import {
  cometHeadSize,
  createCometLaunchSample,
  createCometLaunchState,
  reconcileCometLaunch,
  stepCometLaunchEase,
  type CometLaunchSample,
} from "../motion/comet-launch-ease.ts";

const C = (...shas: string[]) => shas.map((sha) => ({ sha }));

/** Verbatim port of the universe-scene c22/c53 loop (reference). */
function sceneLoop(comets: CommitCometsHandle, samples: CometLaunchSample[], reducedMotion: boolean) {
  for (let ci = 0; ci < comets.count; ci++) {
    const sample = samples[ci];
    if (!sample) continue;
    const line = comets.group.getObjectByName(`motion-comet-${ci}`);
    const head = comets.group.getObjectByName(`motion-comet-head-${ci}`);
    if (line) {
      line.visible = sample.visible || reducedMotion;
      const mat = (line as THREE.Line).material as THREE.LineBasicMaterial;
      if (mat && "opacity" in mat) mat.opacity = (reducedMotion ? 0.22 : 0.55) * Math.max(sample.opacity, reducedMotion ? 1 : 0);
    }
    if (head) {
      head.visible = sample.visible || reducedMotion;
      const mat = (head as THREE.Points).material as THREE.PointsMaterial;
      if (mat && "opacity" in mat) {
        mat.opacity = (reducedMotion ? 0.35 : 0.95) * Math.max(sample.opacity, reducedMotion ? 1 : 0);
        const base = typeof head.userData.baseSize === "number" ? head.userData.baseSize : (mat.size || 0.2);
        mat.size = cometHeadSize(base, sample, reducedMotion);
      }
    }
  }
}

function snapshot(h: CommitCometsHandle) {
  return h.lines!.map((l, i) => {
    const hd = h.heads![i]!;
    return [l.visible, (l.material as THREE.Material).opacity, hd.visible, (hd.material as THREE.Material).opacity, (hd.material as THREE.PointsMaterial).size];
  });
}

describe("c24 — applyCometLaunchSamples", () => {
  it("matches the scene loop frame-by-frame through a staggered launch (normal + reduced)", () => {
    for (const rm of [false, true]) {
      const sa = new THREE.Scene();
      const sb = new THREE.Scene();
      const a = createCommitComets(sa, C("a1", "b2", "c3", "d4", "e5", "f6"), { max: 6 });
      const b = createCommitComets(sb, C("a1", "b2", "c3", "d4", "e5", "f6"), { max: 6 });
      const st = createCometLaunchState(24);
      const samples = Array.from({ length: 24 }, () => createCometLaunchSample());
      reconcileCometLaunch(st, a.shas!, rm);
      for (let f = 0; f < 90; f++) {
        stepCometLaunchEase(st, samples, 1 / 60, rm);
        sceneLoop(a, samples, rm);
        applyCometLaunchSamples(b, samples, rm);
        assert.deepEqual(snapshot(b), snapshot(a), `frame ${f} rm=${rm}`);
      }
      a.dispose();
      b.dispose();
    }
  });

  it("does no getObjectByName tree walks", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "b", "c"), {});
    let walks = 0;
    const orig = h.group.getObjectByName.bind(h.group);
    h.group.getObjectByName = ((n: string) => {
      walks++;
      return orig(n);
    }) as typeof h.group.getObjectByName;
    const samples = Array.from({ length: 3 }, () => createCometLaunchSample());
    for (let f = 0; f < 60; f++) applyCometLaunchSamples(h, samples, false);
    assert.equal(walks, 0);
    h.dispose();
  });

  it("hostile inputs: null/short/NaN samples hide (never NaN); disposed/null handle → 0", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "b", "c"), {});
    const bad = [null, { opacity: Number.NaN, scale: Number.NaN, visible: true, amount: 0, done: false }] as never;
    assert.equal(applyCometLaunchSamples(h, bad, false), 1);
    for (let i = 0; i < 3; i++) {
      const lm = h.lines![i]!.material as THREE.Material;
      const hm = h.heads![i]!.material as THREE.PointsMaterial;
      assert.ok(Number.isFinite(lm.opacity) && Number.isFinite(hm.opacity) && Number.isFinite(hm.size));
    }
    assert.equal(h.lines![0]!.visible, false);
    assert.equal(h.lines![2]!.visible, false, "missing sample hides");
    assert.equal(applyCometLaunchSamples(h, null, true), 3, "reduced shows static marks");
    assert.equal(applyCometLaunchSamples(h, "x" as never, false), 0);
    h.dispose();
    assert.equal(h.lines!.length, 0);
    assert.equal(applyCometLaunchSamples(h, [], false), 0);
    assert.equal(applyCometLaunchSamples(null, [], false), 0);
    // Hand-built handle without lines/heads (pre-c24 shape) → 0, no throw.
    assert.equal(applyCometLaunchSamples({ group: new THREE.Group(), count: 3, disposed: false, update() {}, dispose() {} }, [], false), 0);
  });
});
