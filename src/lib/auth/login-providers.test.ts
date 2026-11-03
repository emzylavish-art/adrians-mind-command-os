import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLoginCallbackError,
  dashboardLoginSearch,
  emailPasswordGate,
  isOwnerBrokerConfigured,
  loginCallbackFailureKind,
  loginErrorBannerFromSearch,
  parseSupabaseOAuthProviders,
  resolveLoginProviderAction,
} from "./login-providers.ts";

describe("resolveLoginProviderAction", () => {
  it("routes Google/GitHub/Apple through Supabase when configured and listed", () => {
    for (const provider of ["google", "github", "apple"] as const) {
      assert.deepEqual(
        resolveLoginProviderAction(provider, {
          supabaseConfigured: true,
          betterAuthEnabled: true,
          supabaseOAuthProviders: ["google", "github", "apple"],
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

describe("loginErrorBannerFromSearch / classifyLoginCallbackError", () => {
  it("ignores empty and bare broker noise so stale restore stays quiet", () => {
    assert.equal(loginErrorBannerFromSearch(undefined), null);
    assert.equal(loginErrorBannerFromSearch(""), null);
    assert.equal(loginErrorBannerFromSearch("1"), null);
    assert.equal(classifyLoginCallbackError("1"), null);
  });

  it("surfaces auth callback errors as a red auth_error banner line", () => {
    assert.equal(loginErrorBannerFromSearch("Missing authorization code."), "Missing authorization code.");
    assert.equal(loginCallbackFailureKind("Missing authorization code."), "auth_error");
    assert.equal(loginCallbackFailureKind("access_denied"), "auth_error");
    assert.equal(
      loginErrorBannerFromSearch("Could not complete sign-in."),
      "Could not complete sign-in.",
    );
    assert.deepEqual(classifyLoginCallbackError("Sign-in isn't configured yet."), {
      kind: "auth_error",
      message: "Sign-in isn't configured yet.",
    });
  });

  it("classifies immutable/500-style callback failures as server_error", () => {
    const msg = "TypeError: immutable";
    assert.equal(loginErrorBannerFromSearch(msg), msg);
    assert.equal(loginCallbackFailureKind(msg), "server_error");
    assert.equal(loginCallbackFailureKind("Internal Server Error"), "server_error");
    assert.equal(loginCallbackFailureKind("HTTP 500 from callback"), "server_error");
    assert.equal(loginCallbackFailureKind("mergeEventResponseHeaders failed"), "server_error");
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

describe("parseSupabaseOAuthProviders", () => {
  it("defaults to none when unset or empty", () => {
    assert.deepEqual(parseSupabaseOAuthProviders(undefined), []);
    assert.deepEqual(parseSupabaseOAuthProviders(""), []);
    assert.deepEqual(parseSupabaseOAuthProviders(" , "), []);
  });

  it("parses a comma/space list and ignores unknown ids", () => {
    assert.deepEqual(parseSupabaseOAuthProviders("google, github"), ["google", "github"]);
    assert.deepEqual(parseSupabaseOAuthProviders("Apple GOOGLE twitter"), ["apple", "google"]);
  });
});

describe("resolveLoginProviderAction supabase OAuth allowlist", () => {
  it("disables Supabase OAuth providers when the allowlist is empty (default)", () => {
    for (const provider of ["github", "apple"] as const) {
      const action = resolveLoginProviderAction(provider, {
        supabaseConfigured: true,
        betterAuthEnabled: false,
        supabaseOAuthProviders: [],
      });
      assert.equal(action.kind, "not_configured");
      assert.equal((action as { message: string }).message, "Not enabled yet");
    }
  });

  it("falls back to broker Google when Supabase Google is not allowlisted", () => {
    assert.deepEqual(
      resolveLoginProviderAction("google", {
        supabaseConfigured: true,
        betterAuthEnabled: true,
        supabaseOAuthProviders: [],
      }),
      { kind: "better_auth", providerId: "grok-google", label: "Google" },
    );
  });

  it("enables only listed Supabase OAuth providers", () => {
    assert.deepEqual(
      resolveLoginProviderAction("github", {
        supabaseConfigured: true,
        betterAuthEnabled: false,
        supabaseOAuthProviders: ["github"],
      }),
      { kind: "supabase_oauth", provider: "github" },
    );
    const apple = resolveLoginProviderAction("apple", {
      supabaseConfigured: true,
      betterAuthEnabled: false,
      supabaseOAuthProviders: ["github"],
    });
    assert.equal(apple.kind, "not_configured");
    assert.equal((apple as { message: string }).message, "Not enabled yet");
  });
});
