import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStatusServerCache } from "./status-server-cache.ts";

describe("status-server-cache (Gap#28)", () => {
  it("returns cached value within TTL without rebuilding", async () => {
    const cache = createStatusServerCache<{ n: number }>(50);
    let builds = 0;
    const build = async () => {
      builds += 1;
      return { n: builds };
    };
    const a = await cache.get(build, 1000);
    const b = await cache.get(build, 1020);
    assert.deepEqual(a, { n: 1 });
    assert.deepEqual(b, { n: 1 });
    assert.equal(builds, 1);
  });

  it("single-flights concurrent misses", async () => {
    const cache = createStatusServerCache<{ n: number }>(1000);
    let builds = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const build = async () => {
      builds += 1;
      await gate;
      return { n: builds };
    };
    const p1 = cache.get(build, 0);
    const p2 = cache.get(build, 0);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    assert.deepEqual(a, b);
    assert.equal(builds, 1);
  });

  it("rebuilds after TTL", async () => {
    const cache = createStatusServerCache<{ n: number }>(10);
    let builds = 0;
    const build = async () => ({ n: ++builds });
    await cache.get(build, 0);
    await cache.get(build, 50);
    assert.equal(builds, 2);
  });
});
