import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickSessionUser } from "./session-user.ts";

describe("pickSessionUser", () => {
  it("prefers Supabase when both sessions exist", () => {
    assert.deepEqual(
      pickSessionUser({
        supabaseUser: { id: "sb-1", email: "a@b.co" },
        betterAuthUser: { id: "ba-1", email: "c@d.co" },
      }),
      { id: "sb-1", email: "a@b.co" },
    );
  });

  it("falls back to Better Auth when Supabase is absent", () => {
    assert.deepEqual(
      pickSessionUser({
        supabaseUser: null,
        betterAuthUser: { id: "ba-1", email: null },
      }),
      { id: "ba-1", email: null },
    );
  });

  it("returns null when neither session is present", () => {
    assert.equal(
      pickSessionUser({ supabaseUser: null, betterAuthUser: null }),
      null,
    );
    assert.equal(
      pickSessionUser({
        supabaseUser: { id: "", email: "x" },
        betterAuthUser: { id: "", email: "y" },
      }),
      null,
    );
  });
});
