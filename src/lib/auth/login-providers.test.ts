import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dashboardLoginSearch,
  emailPasswordGate,
  isOwnerBrokerConfigured,
  loginErrorBannerFromSearch,
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
    assert.match((github as { message: string }).message, /configured yet/i);
  });

  it("returns not_configured for Google/X when broker env is missing", () => {
    const google = resolveLoginProviderAction("google", {
      supabaseConfigured: false,
      betterAuthEnabled: false,
    });
    assert.equal(google.kind, "not_configured");
    assert.match((google as { message: string }).message, /configured yet/i);
    const x = resolveLoginProviderAction("x", {
      supabaseConfigured: false,
      betterAuthEnabled: false,
    });
    assert.equal(x.kind, "not_configured");
    assert.match((x as { message: string }).message, /configured yet/i);
  });
});

describe("emailPasswordGate", () => {
  it("blocks email when Supabase env is missing", () => {
    const blocked = emailPasswordGate(false);
    assert.equal(blocked.ok, false);
    assert.match((blocked as { message: string }).message, /SUPABASE_URL/);
  });
});

describe("loginErrorBannerFromSearch", () => {
  it("never seeds a red banner from an error query param alone", () => {
    assert.equal(loginErrorBannerFromSearch(undefined), null);
    assert.equal(loginErrorBannerFromSearch("Sign-in failed"), null);
    assert.equal(loginErrorBannerFromSearch("anything"), null);
  });
});

describe("dashboardLoginSearch", () => {
  it("redirects to login with next=/dashboard and no error param", () => {
    const search = dashboardLoginSearch();
    assert.deepEqual(search, { next: "/dashboard" });
    assert.equal("error" in search, false);
  });
});

describe("isOwnerBrokerConfigured", () => {
  it("requires real GROK_AUTH client id and secret", () => {
    assert.equal(isOwnerBrokerConfigured({}), false);
    assert.equal(
      isOwnerBrokerConfigured({
        VITE_AUTH_ENABLED: "true",
        GROK_AUTH_CLIENT_ID: "id",
      }),
      false,
    );
    assert.equal(
      isOwnerBrokerConfigured({
        VITE_AUTH_ENABLED: "false",
        GROK_AUTH_CLIENT_ID: "id",
        GROK_AUTH_CLIENT_SECRET: "secret",
      }),
      false,
    );
    assert.equal(
      isOwnerBrokerConfigured({
        GROK_AUTH_CLIENT_ID: "id",
        GROK_AUTH_CLIENT_SECRET: "secret",
      }),
      true,
    );
  });
});
