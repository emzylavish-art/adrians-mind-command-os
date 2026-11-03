import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearStatusCache,
  formatStaleSinceWAT,
  isStatusCachePayload,
  readStatusCache,
  writeStatusCache,
} from "./status-cache.ts";

function memStorage(): { store: Map<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(k: string) { return store.has(k) ? store.get(k)! : null; },
    setItem(k: string, v: string) { store.set(k, String(v)); },
    removeItem(k: string) { store.delete(k); },
  };
}

describe("status-cache (#36 Gap#13)", () => {
  it("rejects non-status payloads", () => {
    assert.equal(isStatusCachePayload(null), false);
    assert.equal(isStatusCachePayload({}), false);
    assert.equal(isStatusCachePayload({ bots: "x" }), false);
    assert.equal(isStatusCachePayload({ bots: [] }), true);
  });

  it("round-trips last-good; corrupt / hostile storage returns null", () => {
    const s = memStorage();
    assert.equal(writeStatusCache(s, { bots: [{ id: "a" }], spend: { available: false } }, "2026-11-01T20:00:00.000Z"), true);
    const got = readStatusCache<{ bots: unknown[] }>(s);
    assert.ok(got);
    assert.equal(got!.savedAt, "2026-11-01T20:00:00.000Z");
    assert.equal(got!.data.bots.length, 1);
    s.setItem("dash3d:last-good-status:v1", "{not-json");
    assert.equal(readStatusCache(s), null);
    assert.equal(writeStatusCache(s, { nope: true } as any), false);
    clearStatusCache(s);
  });

  it("formatStaleSinceWAT labels Africa/Lagos", () => {
    const label = formatStaleSinceWAT("2026-11-01T20:43:00.000Z");
    assert.match(label, /WAT$/);
    assert.match(label, /\d{2}:\d{2}/);
  });
});
