import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_AMOUNT_USD,
  NO_SPEND_SOURCE,
  buildMoneyView,
  createFilesystemSpendAdapter,
  parseSpendFileText,
  parseSpendRecord,
  sanitizeAmountUsd,
  type SpendAdapter,
  type SpendLoadResult,
} from "./spend.ts";

const NOW = Date.parse("2026-11-01T18:00:00+01:00");

describe("spend / money (hacker + queue #7)", () => {
  it("sanitizes NaN, negative, Infinity, overflow", () => {
    assert.equal(sanitizeAmountUsd(Number.NaN), null);
    assert.equal(sanitizeAmountUsd(Number.POSITIVE_INFINITY), null);
    assert.equal(sanitizeAmountUsd(-1), null);
    assert.equal(sanitizeAmountUsd(MAX_AMOUNT_USD + 1), null);
    assert.equal(sanitizeAmountUsd(12.5), 12.5);
    assert.equal(parseSpendRecord({ at: "2026-11-01T12:00:00Z", amountUsd: -3 }, "t", NOW), null);
    assert.equal(parseSpendRecord({ at: "nope", amountUsd: 1 }, "t", NOW), null);
  });

  it("empty filesystem → no spend source yet; never invents totals", () => {
    const adapter = createFilesystemSpendAdapter({ roots: ["/tmp/definitely-missing-spend-root-xyz"] });
    const loaded = adapter.load({ nowMs: NOW, exists: () => false });
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.equal(loaded.reason, NO_SPEND_SOURCE);
    const money = buildMoneyView({ loadResult: loaded, nowMs: NOW });
    assert.equal(money.available, false);
    assert.equal(money.reason, NO_SPEND_SOURCE);
    assert.equal(money.todayTotalUsd, null);
    assert.equal(money.burnPerHourUsd, null);
    assert.deepEqual(money.warnings, []);
  });

  it("parses real fixture events; warnings only above threshold; stale suppresses burn/warnings", () => {
    const text = JSON.stringify([
      { at: "2026-11-01T17:30:00+01:00", amountUsd: 40, lane: "dashboard", model: "grok" },
      { at: "2026-11-01T17:45:00+01:00", amountUsd: 10.25, lane: "dashboard" },
      { at: "2026-11-01T17:50:00+01:00", amountUsd: "NaN" },
      { at: "2026-11-01T17:51:00+01:00", amountUsd: -9 },
      { at: "2026-10-01T12:00:00+01:00", amountUsd: 999999999 }, // overflow + old
    ]);
    const parsed = parseSpendFileText(text, "/fixture/spend.json", NOW);
    assert.ok(parsed.droppedInvalid >= 2);
    assert.equal(parsed.events.length, 2);

    const loadResult: SpendLoadResult = {
      ok: true,
      events: parsed.events,
      source: "/fixture/spend.json",
      droppedInvalid: parsed.droppedInvalid,
    };
    const money = buildMoneyView({
      loadResult,
      nowMs: NOW,
      warnTodayUsd: 25,
      critTodayUsd: 100,
    });
    assert.equal(money.available, true);
    assert.equal(money.todayTotalUsd, 50.25);
    assert.ok((money.burnPerHourUsd ?? 0) >= 50);
    assert.equal(money.warnings.length, 1);
    assert.equal(money.warnings[0]!.level, "warn");

    // Stale: move now far ahead
    const stale = buildMoneyView({
      loadResult,
      nowMs: NOW + 3 * 24 * 3600_000,
      warnTodayUsd: 25,
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.burnPerHourUsd, null);
    assert.deepEqual(stale.warnings, []);
  });

  it("adapter interface is pluggable (custom load)", () => {
    const custom: SpendAdapter = {
      id: "test-adapter",
      load: () => ({
        ok: true,
        source: "memory",
        droppedInvalid: 0,
        events: [
          {
            atIso: "2026-11-01T17:00:00+01:00",
            atMs: Date.parse("2026-11-01T17:00:00+01:00"),
            amountUsd: 120,
            currency: "USD",
            lane: null,
            model: null,
            source: "memory",
          },
        ],
      }),
    };
    const money = buildMoneyView({ loadResult: custom.load({ nowMs: NOW }), nowMs: NOW });
    assert.equal(money.available, true);
    assert.equal(money.warnings[0]?.level, "crit");
  });
});
