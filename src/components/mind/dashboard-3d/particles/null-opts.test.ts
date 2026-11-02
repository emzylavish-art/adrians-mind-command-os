/**
 * Hacker c24: createCommitComets / createDustField read `opts.max` / `opts.count`
 * before coalescing. A null / non-object opts bag threw
 * `Cannot read properties of null (reading 'max'|'count')` at construction —
 * aborting the 5s sync / dust mount for the rest of the session.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createCommitComets, syncCommitComets } from "./commit-comets.ts";
import { createDustField } from "./dust-field.ts";

describe("hacker c24 — null / non-object create opts", () => {
  it("createCommitComets tolerates null/undefined/primitive opts", () => {
    const scene = new THREE.Scene();
    for (const opts of [null, undefined, 7, "x", true] as const) {
      let h: ReturnType<typeof createCommitComets> | undefined;
      assert.doesNotThrow(() => {
        h = createCommitComets(scene, [{ sha: "abc" }], opts as never);
      }, String(opts));
      assert.ok(h);
      assert.equal(h!.count, 1);
      assert.equal(h!.disposed, false);
      h!.dispose();
    }
  });

  it("createDustField tolerates null/undefined/primitive opts", () => {
    const scene = new THREE.Scene();
    for (const opts of [null, undefined, 0, "nope"] as const) {
      let h: ReturnType<typeof createDustField> | undefined;
      assert.doesNotThrow(() => {
        h = createDustField(scene, opts as never);
      }, String(opts));
      assert.ok(h);
      assert.equal(h!.disposed, false);
      h!.dispose();
      assert.equal(h!.disposed, true);
    }
  });

  it("syncCommitComets forwards null opts without throw", () => {
    const scene = new THREE.Scene();
    const h = syncCommitComets(scene, null, [{ sha: "z" }], null as never);
    assert.equal(h.count, 1);
    h.dispose();
  });
});
