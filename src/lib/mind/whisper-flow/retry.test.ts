import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTransientSttError, nextRetryPlan, withBackoffRetry } from "./retry.ts";

describe("whisper-flow retry", () => {
  it("grows backoff and stops after max attempts", () => {
    const a1 = nextRetryPlan(0, { baseMs: 100, maxAttempts: 3 });
    assert.equal(a1.shouldRetry, true);
    assert.equal(a1.delayMs, 100);
    const a3 = nextRetryPlan(2, { baseMs: 100, maxAttempts: 3 });
    assert.equal(a3.shouldRetry, true);
    assert.equal(a3.delayMs, 400);
    const done = nextRetryPlan(3, { baseMs: 100, maxAttempts: 3 });
    assert.equal(done.shouldRetry, false);
  });

  it("retries transient STT failures and keeps the same payload path", async () => {
    const seen: number[] = [];
    const result = await withBackoffRetry(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) return { ok: false as const, error: "Speech-to-text did not answer in time. Nothing was transcribed." };
        return { ok: true as const, text: "recovered" };
      },
      { maxAttempts: 3, baseMs: 1, maxMs: 5 },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((result as { text: string }).text, "recovered");
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    const result = await withBackoffRetry(
      async () => {
        calls += 1;
        return { ok: false as const, error: "No speech key is configured. Nothing was transcribed." };
      },
      {
        maxAttempts: 3,
        baseMs: 1,
        isRetryable: (r) => !r.ok && isTransientSttError(r.error),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  });

  it("classifies timeout/5xx as transient", () => {
    assert.equal(isTransientSttError("Speech-to-text did not answer in time."), true);
    assert.equal(isTransientSttError("Speech-to-text returned 503."), true);
    assert.equal(isTransientSttError("No speech key is configured."), false);
  });
});
