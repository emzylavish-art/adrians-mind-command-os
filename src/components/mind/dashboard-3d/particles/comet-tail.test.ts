import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { cometHeadSpriteRefs, cometTailFade, createCommitComets, flushCometHeadSprite } from "./commit-comets.ts";
import { createMotionClock } from "../motion/motion-clock.ts";

describe("comet tail fade + head glow (c4)", () => {
  it("fade is 1 at head, 0 at tail, monotonic, NaN-safe", () => {
    assert.equal(cometTailFade(0), 1);
    assert.equal(cometTailFade(1), 0);
    assert.equal(cometTailFade(Number.NaN), 0);
    assert.equal(cometTailFade(-3), 1);
    let prev = 2;
    for (let u = 0; u <= 1; u += 0.05) {
      const f = cometTailFade(u);
      assert.ok(f <= prev);
      prev = f;
    }
  });

  it("each comet gets an additive vertex-color gradient line + a head point that tracks the arc", () => {
    const scene = new THREE.Scene();
    const c = createCommitComets(scene, [{ sha: "9b019c8" }, { sha: "7a6e24f" }], { clock: createMotionClock() });
    assert.equal(c.count, 2);
    const lines = c.group.children.filter((o) => (o as THREE.Line).isLine) as THREE.Line[];
    const heads = c.group.children.filter((o) => (o as THREE.Points).isPoints) as THREE.Points[];
    assert.equal(lines.length, 2);
    assert.equal(heads.length, 2);
    for (const line of lines) {
      const mat = line.material as THREE.LineBasicMaterial;
      assert.equal(mat.vertexColors, true);
      assert.equal(mat.blending, THREE.AdditiveBlending);
      const col = line.geometry.getAttribute("color") as THREE.BufferAttribute;
      const n = col.count;
      const lum = (i: number) => col.getX(i) + col.getY(i) + col.getZ(i);
      assert.ok(lum(0) > 0.5, "head bright");
      assert.equal(lum(n - 1), 0, "tail end fully faded");
      for (let i = 1; i < n; i++) assert.ok(lum(i) <= lum(i - 1) + 1e-6);
    }
    c.update(3.3, false);
    c.update(3.3 + 1 / 60, false);
    for (let i = 0; i < 2; i++) {
      const lp = lines[i]!.geometry.getAttribute("position") as THREE.BufferAttribute;
      const hp = heads[i]!.geometry.getAttribute("position") as THREE.BufferAttribute;
      assert.ok(Math.abs(hp.getX(0) - lp.getX(0)) < 1e-6);
      assert.ok(Math.abs(hp.getY(0) - lp.getY(0)) < 1e-6);
      assert.ok(Math.abs(hp.getZ(0) - lp.getZ(0)) < 1e-6);
      assert.ok(Number.isFinite(hp.getX(0)));
    }
    c.dispose();
  });

  it("reduced motion dims but keeps the static comet visible", () => {
    const scene = new THREE.Scene();
    const c = createCommitComets(scene, [{ sha: "abc" }], { clock: createMotionClock() });
    c.update(1, true);
    const line = c.group.children.find((o) => (o as THREE.Line).isLine) as THREE.Line;
    const head = c.group.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    const lo = (line.material as THREE.Material).opacity;
    const ho = (head.material as THREE.Material).opacity;
    assert.ok(lo > 0 && lo < 0.9);
    assert.ok(ho > 0 && ho < 0.95);
    c.dispose();
  });

  it("5s rebuild churn shares one head sprite and frees every GPU resource", () => {
    const scene = new THREE.Scene();
    const disposed = new Set<string>();
    const track = (o: { uuid: string; addEventListener: (t: "dispose", f: () => void) => void }) =>
      o.addEventListener("dispose", () => disposed.add(o.uuid));
    let sprite: THREE.Texture | null = null;
    const owned: string[] = [];
    const base = cometHeadSpriteRefs();
    for (let k = 0; k < 20; k++) {
      const c = createCommitComets(scene, [{ sha: "a" }, { sha: "b" }, { sha: "c" }]);
      for (const o of c.group.children as THREE.Mesh[]) {
        track(o.geometry);
        track(o.material as THREE.Material);
        owned.push(o.geometry.uuid, (o.material as THREE.Material).uuid);
        const map = (o.material as THREE.PointsMaterial).map;
        if (map) {
          if (sprite) assert.equal(map, sprite, "sprite must be shared across rebuilds");
          sprite = map;
        }
      }
      assert.equal(cometHeadSpriteRefs(), base + 1);
      c.dispose();
      c.dispose();
    }
    for (const id of owned) assert.ok(disposed.has(id), `leaked ${id}`);
    assert.equal(cometHeadSpriteRefs(), base);
    let spriteFreed = false;
    sprite!.addEventListener("dispose", () => (spriteFreed = true));
    assert.equal(spriteFreed, false, "sprite kept through the grace period");
    assert.equal(flushCometHeadSprite(), true);
    assert.equal(spriteFreed, true, "idle sprite freed after grace");
    assert.equal(scene.children.length, 0);
  });

  it("no commits → no sprite acquired", () => {
    const base = cometHeadSpriteRefs();
    const c = createCommitComets(new THREE.Scene(), []);
    assert.equal(cometHeadSpriteRefs(), base);
    c.dispose();
    assert.equal(cometHeadSpriteRefs(), base);
  });
});
