import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SPEAK_SESSION_TIMEOUT_MESSAGE, SpeakSessionTimeoutError, withSessionTimeout } from "./session-timeout.ts";

describe("withSessionTimeout", () => {
  it("rejects a session mint that never settles", async () => {
    await assert.rejects(
      () => withSessionTimeout(() => new Promise(() => undefined), 20),
      (err: unknown) => {
        assert.ok(err instanceof SpeakSessionTimeoutError);
        assert.equal((err as Error).message, SPEAK_SESSION_TIMEOUT_MESSAGE);
        return true;
      },
    );
  });

  it("returns the secret when the mint settles in time", async () => {
    const secret = await withSessionTimeout(async () => ({ ok: true as const, value: "ephemeral" }), 200);
    assert.equal(secret.value, "ephemeral");
  });

  it("does not report a timeout when the caller aborts", async () => {
    const signal = AbortSignal.abort();
    await assert.rejects(
      () => withSessionTimeout(() => new Promise(() => undefined), 500, signal),
      (err: unknown) => (err as { name?: string }).name === "AbortError",
    );
  });
});
