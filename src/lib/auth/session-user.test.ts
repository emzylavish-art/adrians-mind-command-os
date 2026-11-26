import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickSessionUser, localPreviewIdentityAllowed } from "./session-user.ts";

describe("pickSessionUser", () => {
  it("rejects conflicting verified sessions instead of selecting another owner", () => {
    assert.deepEqual(
      pickSessionUser({
        supabaseUser: { id: "sb-1", email: "a@b.co" },
        betterAuthUser: { id: "ba-1", email: "c@d.co" },
      }),
      null,
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

describe("anonymous workstation identity", () => {
  it("requires loopback and an identified local runtime", () => {
    assert.equal(localPreviewIdentityAllowed("localhost:8080", { NODE_ENV: "development" }), true);
    assert.equal(localPreviewIdentityAllowed("[::1]:41731", { NODE_ENV: "production", ADRIAN_PC: "1" }), true);
    for (const host of ["public.example", "localhost.evil", "127.0.0.1@public.example"]) {
      assert.equal(localPreviewIdentityAllowed(host, { NODE_ENV: "development" }), false);
    }
    assert.equal(localPreviewIdentityAllowed("localhost", { NODE_ENV: "production" }), false);
  });
  it("refuses loopback identity on hosted or database-backed runtimes", () => {
    for (const key of ["VERCEL", "VERCEL_URL", "VERCEL_ENV", "GROK_PROJECT_ID", "DATABASE_URL", "POSTGRES_URL"]) {
      assert.equal(localPreviewIdentityAllowed("127.0.0.1", { ADRIAN_PC: "1", [key]: "fixture" }), false, key);
    }
  });
});
