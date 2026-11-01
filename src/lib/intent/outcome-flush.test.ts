import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flushIntentOutcomeQueue,
  readOutcomeQueue,
  removeAcknowledged,
  writeOutcomeQueue,
  type FlushFetch,
  type QueuedOutcome,
} from "./outcome-flush.ts";
import { INTENT_OUTCOMES_KEY } from "./outcome-reporter.ts";

function memoryStore(seed?: string) {
  const map = new Map<string, string>();
  if (seed) map.set(INTENT_OUTCOMES_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

const sample: QueuedOutcome[] = [
  {
    intentId: "view:memory",
    accepted: true,
    source: "keystroke",
    query: "mem",
    score: 0.9,
    at: 100,
    clientId: "c-a",
  },
  {
    intentId: "model:Fast",
    accepted: false,
    source: "voice",
    query: "fast",
    score: 0.4,
    at: 200,
    clientId: "c-b",
    patternId: "11111111-1111-4111-8111-111111111111",
  },
];

describe("outcome-flush", () => {
  it("reads and writes the localStorage queue with clientIds", () => {
    const store = memoryStore();
    writeOutcomeQueue(store, sample);
    const rows = readOutcomeQueue(store);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.clientId, "c-a");
    assert.equal(rows[1]!.patternId?.startsWith("1111"), true);
  });

  it("removeAcknowledged drops only acked ids", () => {
    const left = removeAcknowledged(sample, ["c-a", "missing"]);
    assert.deepEqual(
      left.map((r) => r.clientId),
      ["c-b"],
    );
  });

  it("is a no-op when signed out and does not clear the queue", async () => {
    const store = memoryStore();
    writeOutcomeQueue(store, sample);
    let called = 0;
    const fetchImpl: FlushFetch = async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const result = await flushIntentOutcomeQueue({
      store,
      isSignedIn: false,
      fetchImpl,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "signed-out");
    assert.equal(called, 0);
    assert.equal(readOutcomeQueue(store).length, 2);
  });

  it("clears only acknowledged items after a successful flush", async () => {
    const store = memoryStore();
    writeOutcomeQueue(store, sample);
    const fetchImpl: FlushFetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { items: { clientId: string }[] };
      assert.equal(body.items.length, 2);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          inserted: 1,
          acknowledged: ["c-a"],
        }),
      };
    };
    const result = await flushIntentOutcomeQueue({
      store,
      isSignedIn: true,
      fetchImpl,
    });
    assert.equal(result.skipped, false);
    assert.equal(result.cleared, 1);
    assert.equal(result.inserted, 1);
    const left = readOutcomeQueue(store);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.clientId, "c-b");
  });

  it("leaves the queue intact on 401 / 503", async () => {
    const store = memoryStore();
    writeOutcomeQueue(store, sample);
    for (const status of [401, 503]) {
      writeOutcomeQueue(store, sample);
      const result = await flushIntentOutcomeQueue({
        store,
        isSignedIn: true,
        fetchImpl: async () => ({
          ok: false,
          status,
          json: async () => ({ ok: false }),
        }),
      });
      assert.equal(result.skipped, true);
      assert.equal(readOutcomeQueue(store).length, 2);
    }
  });

  it("falls back to clearing the sent batch when ack list is empty but ok", async () => {
    const store = memoryStore();
    writeOutcomeQueue(store, sample);
    const result = await flushIntentOutcomeQueue({
      store,
      isSignedIn: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, inserted: 0, acknowledged: [] }),
      }),
    });
    assert.equal(result.skipped, false);
    assert.equal(result.cleared, 2);
    assert.equal(readOutcomeQueue(store).length, 0);
  });
});
