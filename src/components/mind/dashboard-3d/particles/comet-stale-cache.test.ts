/**
 * Hacker c25: applyCometLaunchSamples assumed every lines[i]/heads[i] was a live
 * mesh with a material. After sync/dispose/context-loss, the cache can hold holes
 * (sparse), nulls, or meshes whose material was already disposed/nulled — that threw
 * `Cannot set properties of null (setting 'opacity')` and aborted the frame.
 * dispose() similarly threw when material was already null.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  applyCometLaunchSamples,
  createCommitComets,
  syncCommitComets,
} from "./commit-comets.ts";
import { createCometLaunchSample } from "../motion/comet-launch-ease.ts";

const C = (...shas: string[]) => shas.map((sha) => ({ sha }));

function samples(n: number) {
  return Array.from({ length: n }, () => {
    const s = createCometLaunchSample();
    s.visible = true;
    s.opacity = 1;
    s.scale = 1;
    return s;
  });
}

describe("hacker c25 — stale lines/heads cache + dispose after context loss", () => {
  it("null / hole / missing-material slots never throw; visible count skips them", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, C("a", "b", "c"), { max: 6 });
    assert.equal(h.count, 3);
    const lines = h.lines as THREE.Line[];
    const heads = h.heads as THREE.Points[];
    // Hole in lines (sync removed a slot but left a sparse hole).
    lines[1] = undefined as never;
    // Context-loss style: material disposed + nulled while mesh ref remains.
    const deadMat = heads[0]!.material as THREE.Material;
    deadMat.dispose();
    (heads[0] as THREE.Points).material = null as never;
    // Completely missing head.
    heads[2] = null as never;

    let n = -1;
    assert.doesNotThrow(() => {
      n = applyCometLaunchSamples(h, samples(3), false);
    });
    assert.ok(n >= 0);
    // Only index 1 head may still be intact (line hole + head0 dead + head2 null).
    // Index 1: line hole → skip; so visibleCount should be 0.
    assert.equal(n, 0);

    // Reduced-motion path must also survive.
    assert.doesNotThrow(() => applyCometLaunchSamples(h, samples(3), true));

    // dispose must survive already-null materials / holes.
    assert.doesNotThrow(() => h.dispose());
    assert.equal(h.disposed, true);
    assert.equal(applyCometLaunchSamples(h, samples(3), false), 0);
  });

  it("after sync shrinks the comet list, applying against the OLD handle is a no-op (disposed)", () => {
    const scene = new THREE.Scene();
    const a = createCommitComets(scene, C("a", "b", "c", "d"), {});
    const oldLines = a.lines;
    assert.ok(oldLines && oldLines.length === 4);
    const b = syncCommitComets(scene, a, C("a"), {});
    assert.notEqual(b, a);
    assert.equal(a.disposed, true);
    assert.equal(oldLines!.length, 0, "dispose empties the shared cache array");
    assert.equal(applyCometLaunchSamples(a, samples(4), false), 0);
    assert.equal(b.count, 1);
    assert.equal(applyCometLaunchSamples(b, samples(4), false), 1);
    b.dispose();
  });

  it("sync grow replaces handle; new lines/heads length matches count", () => {
    const scene = new THREE.Scene();
    let h = createCommitComets(scene, C("a"), {});
    h = syncCommitComets(scene, h, C("a", "b", "c"), {});
    assert.equal(h.count, 3);
    assert.equal(h.lines!.length, 3);
    assert.equal(h.heads!.length, 3);
    assert.doesNotThrow(() => applyCometLaunchSamples(h, samples(3), false));
    h.dispose();
  });
});
