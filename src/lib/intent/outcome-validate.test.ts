import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUuid,
  MAX_OUTCOME_BATCH,
  validateOutcomeBatch,
  validateOutcomeItem,
} from "./outcome-validate.ts";

const PATTERN = "11111111-1111-4111-8111-111111111111";

describe("outcome-validate", () => {
  it("accepts a well-formed item and normalizes observedAt", () => {
    const item = validateOutcomeItem({
      intentId: "view:memory",
      patternId: PATTERN,
      hit: true,
      observedAt: 1_700_000_000_000,
      note: "ok",
      clientId: "c-1",
    });
    assert.ok(item);
    assert.equal(item!.intentId, "view:memory");
    assert.equal(item!.patternId, PATTERN);
    assert.equal(item!.hit, true);
    assert.equal(item!.observedAt, new Date(1_700_000_000_000).toISOString());
    assert.equal(item!.clientId, "c-1");
  });

  it("allows missing patternId (server will drop-from-insert but ack)", () => {
    const item = validateOutcomeItem({
      intentId: "model:Fast",
      hit: false,
      observedAt: "2026-11-01T12:00:00.000Z",
    });
    assert.ok(item);
    assert.equal(item!.patternId, null);
    assert.equal(item!.hit, false);
  });

  it("rejects malformed patternId and missing hit/intentId", () => {
    assert.equal(
      validateOutcomeItem({
        intentId: "x",
        patternId: "not-a-uuid",
        hit: true,
        observedAt: Date.now(),
      }),
      null,
    );
    assert.equal(
      validateOutcomeItem({ intentId: "x", hit: "yes", observedAt: Date.now() } as never),
      null,
    );
    assert.equal(
      validateOutcomeItem({ hit: true, observedAt: Date.now() }),
      null,
    );
    assert.equal(isUuid(PATTERN), true);
    assert.equal(isUuid("nope"), false);
  });

  it("validates batch size and shape", () => {
    const bad = validateOutcomeBatch({ items: [] });
    assert.equal(bad.ok, false);

    const tooBig = validateOutcomeBatch({
      items: Array.from({ length: MAX_OUTCOME_BATCH + 1 }, (_, i) => ({
        intentId: `id-${i}`,
        hit: true,
        observedAt: Date.now(),
      })),
    });
    assert.equal(tooBig.ok, false);

    const mixed = validateOutcomeBatch({
      items: [
        { intentId: "a", hit: true, observedAt: Date.now(), clientId: "1" },
        { intentId: "", hit: true, observedAt: Date.now() },
        null,
        { intentId: "b", patternId: PATTERN, hit: false, observedAt: Date.now(), clientId: "2" },
      ],
    });
    assert.equal(mixed.ok, true);
    if (mixed.ok) {
      assert.equal(mixed.items.length, 2);
      assert.equal(mixed.droppedInvalid, 2);
      assert.equal(mixed.items[1]!.patternId, PATTERN);
    }
  });
});
