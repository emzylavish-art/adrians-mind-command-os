import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createCommitComets } from "./commit-comets.ts";

describe("commit-comets", () => {
  it("creates at most max trails from real commit inputs", () => {
    const scene = new THREE.Scene();
    const commits = [
      { sha: "abc1234", subject: "one" },
      { sha: "def5678", subject: "two" },
      { sha: "ghi9012", subject: "three" },
    ];
    const handle = createCommitComets(scene, commits, { max: 2, segments: 12 });
    assert.equal(handle.count, 2);
    assert.equal(scene.children.includes(handle.group), true);
    handle.update(1.2, false);
    handle.update(1.2, true);
    handle.dispose();
    assert.equal(scene.children.includes(handle.group), false);
  });

  it("handles empty commit list honestly", () => {
    const scene = new THREE.Scene();
    const handle = createCommitComets(scene, [], { max: 6 });
    assert.equal(handle.count, 0);
    handle.update(0, false);
    handle.dispose();
  });
});
