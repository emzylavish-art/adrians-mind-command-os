import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateImagineImages } from "./imagine.ts";
import { resetImagineRateLimitForTests } from "./harden.ts";
import {
  createFileSpendLedger,
  estimateImagineCostUsd,
  getImagineDailyCap,
  resetImagineSpendLedgerForTests,
  setImagineSpendLedger,
} from "./spend-ledger.ts";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("adversarial: Imagine spend controls inside generateImagineImages", () => {
  it("refuses generate without meter.ownerId (custom execute cannot bypass)", async () => {
    resetImagineRateLimitForTests();
    resetImagineSpendLedgerForTests();
    const result = await generateImagineImages(
      { prompt: "no owner" },
      {
        apiKey: "test-key", reserveDispatch: async () => ({ ok: true }),
        fetchImpl: async () => {
          throw new Error("must not fetch without owner");
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /owner/i);
      assert.equal(result.status, 400);
    }
  });

  it("enforces daily spend cap before calling xAI", async () => {
    resetImagineRateLimitForTests();
    const dir = mkdtempSync(join(tmpdir(), "imagine-spend-"));
    const ledger = createFileSpendLedger(join(dir, "ledger.json"));
    setImagineSpendLedger(ledger);
    const owner = "cap-owner";
    const cap = getImagineDailyCap();
    // Fill ledger to the cap
    for (let i = 0; i < cap; i++) {
      ledger.record({ ownerId: owner, model: "grok-imagine-image", n: 1, at: Date.now() });
    }
    const result = await generateImagineImages(
      { prompt: "over cap" },
      {
        apiKey: "test-key", reserveDispatch: async () => ({ ok: true }),
        meter: { ownerId: owner, sessionId: "s1" },
        fetchImpl: async () => {
          throw new Error("must not fetch over daily cap");
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /daily|cap|limit/i);
      assert.equal(result.status, 429);
    }
    rmSync(dir, { recursive: true, force: true });
    resetImagineSpendLedgerForTests();
    resetImagineRateLimitForTests();
  });

  it("records successful generations on the ledger", async () => {
    resetImagineRateLimitForTests();
    resetImagineSpendLedgerForTests();
    const dir = mkdtempSync(join(tmpdir(), "imagine-spend-ok-"));
    const ledger = createFileSpendLedger(join(dir, "ledger.json"));
    setImagineSpendLedger(ledger);
    const owner = "ok-owner";
    const result = await generateImagineImages(
      { prompt: "ok", n: 1 },
      {
        apiKey: "test-key", reserveDispatch: async () => ({ ok: true }),
        meter: { ownerId: owner, sessionId: "s1" },
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }], model: "grok-imagine-image" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    assert.equal(result.ok, true);
    const summary = ledger.summary(owner);
    assert.ok(summary.count >= 1);
    assert.ok(summary.estimatedCostUsd >= estimateImagineCostUsd("grok-imagine-image", 1));
    rmSync(dir, { recursive: true, force: true });
    resetImagineSpendLedgerForTests();
    resetImagineRateLimitForTests();
  });
});
