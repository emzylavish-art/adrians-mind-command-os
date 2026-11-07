import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitFailure, mountFailure, registerFailureHandler, type MountedFailure } from "./failure-mount.ts";

describe("failure mount", () => {
  it("returns false when nobody is registered", () => {
    const payload = mountFailure({ message: "nope" }, () => undefined, "local-1");
    assert.equal(emitFailure("persona", payload), false);
  });

  it("passes the outcome object unchanged and unregisters", () => {
    const outcome = { message: "Sol needs config", missing: ["SOL_API_KEY"] };
    const seen: { current: MountedFailure<typeof outcome> | null } = { current: null };
    const unregister = registerFailureHandler("modelRoute", (payload: MountedFailure<unknown>) => {
      seen.current = payload as MountedFailure<typeof outcome>;
    });
    const retrySelection = { provider: "sol", modelTier: "Heavy" as const, logicRoute: "sol" as const };
    const payload = mountFailure(outcome, () => retrySelection, "local-uuid");
    assert.equal(emitFailure("modelRoute", payload), true);
    assert.equal(seen.current?.outcome, outcome);
    assert.equal(seen.current?.localCorrelationId, "local-uuid");
    assert.deepEqual(seen.current?.retry(), retrySelection);
    unregister();
    assert.equal(emitFailure("modelRoute", payload), false);
  });

  it("does not call a replaced handler", () => {
    let first = 0;
    let second = 0;
    const drop = registerFailureHandler("research", () => {
      first += 1;
    });
    registerFailureHandler("research", () => {
      second += 1;
    });
    const payload = mountFailure({ ok: false }, () => undefined, "local-2");
    assert.equal(emitFailure("research", payload), true);
    assert.equal(first, 0);
    assert.equal(second, 1);
    drop();
    assert.equal(emitFailure("research", payload), true);
    registerFailureHandler("mcp", () => undefined);
    const off = registerFailureHandler("mcp", () => undefined);
    off();
    assert.equal(emitFailure("mcp", payload), false);
  });
});
