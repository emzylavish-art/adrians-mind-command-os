import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emailPasswordGate,
  resolveLoginProviderAction,
} from "./login-providers.ts";

describe("resolveLoginProviderAction", () => {
  it("routes Google/GitHub/Apple through Supabase when configured", () => {
    for (const provider of ["google", "github", "apple"] as const) {
      assert.deepEqual(
        resolveLoginProviderAction(provider, {
          supabaseConfigured: true,
          betterAuthEnabled: true,
        }),
        { kind: "supabase_oauth", provider },
      );
    }
  });

  it("keeps broker Google and X when Supabase is missing", () => {
    assert.deepEqual(
      resolveLoginProviderAction("google", {
        supabaseConfigured: false,
        betterAuthEnabled: true,
      }),
      { kind: "better_auth", providerId: "grok-google", label: "Google" },
    );
    assert.deepEqual(
      resolveLoginProviderAction("x", {
        supabaseConfigured: false,
        betterAuthEnabled: true,
      }),
      { kind: "better_auth", providerId: "grok-x", label: "X" },
    );
  });

  it("returns not_configured for GitHub/Apple without Supabase", () => {
    const github = resolveLoginProviderAction("github", {
      supabaseConfigured: false,
      betterAuthEnabled: true,
    });
    assert.equal(github.kind, "not_configured");
    assert.match((github as { message: string }).message, /GitHub/i);
  });
});

describe("emailPasswordGate", () => {
  it("blocks email when Supabase env is missing", () => {
    const blocked = emailPasswordGate(false);
    assert.equal(blocked.ok, false);
    assert.match((blocked as { message: string }).message, /SUPABASE_URL/);
  });
});
