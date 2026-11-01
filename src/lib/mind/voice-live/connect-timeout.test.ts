import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConnectTimeoutError, isAbortError, withTimeout } from "./connect-timeout.ts";

describe("connect-timeout", () => {
  it("times out a hung promise into ConnectTimeoutError", async () => {
    const hung = new Promise<void>(() => {});
    await assert.rejects(
      () => withTimeout(hung, 30, "mic", "Microphone did not respond in time."),
      (err: unknown) => err instanceof ConnectTimeoutError && err.phase === "mic",
    );
  });

  it("aborts early when AbortSignal fires", async () => {
    const hung = new Promise<void>(() => {});
    const ac = new AbortController();
    const p = withTimeout(hung, 5_000, "mint", "mint hung", ac.signal);
    queueMicrotask(() => ac.abort());
    await assert.rejects(p, (err: unknown) => isAbortError(err));
  });

  it("resolves when the inner promise wins", async () => {
    const value = await withTimeout(Promise.resolve(7), 100, "ws", "ws hung");
    assert.equal(value, 7);
  });
});
