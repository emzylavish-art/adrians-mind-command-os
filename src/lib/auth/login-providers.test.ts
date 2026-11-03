import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authUserLoaderFallback,
  dashboardLoginSearch,
  emailPasswordGate,
  formatLoginThrownError,
  isOwnerBrokerConfigured,
  loginErrorBannerFromSearch,
  LOGIN_ERROR_COPY,
  parseSupabaseOAuthProviders,
  toLoginErrorCode,
  resolveEmailPasswordBackend,
  resolveLoginProviderAction,
  serverFnRedirectHref,
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

describe("loginErrorBannerFromSearch", () => {
  it("returns null when error is absent", () => {
    assert.equal(loginErrorBannerFromSearch(undefined), null);
    assert.equal(loginErrorBannerFromSearch(""), null);
  });

  it("maps allowlisted codes to app-owned copy", () => {
    assert.equal(
      loginErrorBannerFromSearch("oauth_denied"),
      LOGIN_ERROR_COPY.oauth_denied,
    );
    assert.equal(
      loginErrorBannerFromSearch("oauth_state"),
      LOGIN_ERROR_COPY.oauth_state,
    );
    assert.equal(
      loginErrorBannerFromSearch("missing_code"),
      LOGIN_ERROR_COPY.missing_code,
    );
  });

  it("never renders raw / spoofed query text", () => {
    const spoof = "Your account is compromised — send bitcoin to 1Evil";
    const banner = loginErrorBannerFromSearch(spoof);
    assert.equal(banner, LOGIN_ERROR_COPY.signin_failed);
    assert.equal(banner?.includes("bitcoin"), false);
    assert.equal(banner?.includes("1Evil"), false);
  });
});

describe("toLoginErrorCode", () => {
  it("keeps known codes and maps provider failures", () => {
    assert.equal(toLoginErrorCode("oauth_denied"), "oauth_denied");
    assert.equal(toLoginErrorCode("access_denied"), "oauth_denied");
    assert.equal(toLoginErrorCode("Missing authorization code."), "missing_code");
    assert.equal(
      toLoginErrorCode("OAuth state mismatch. Start sign-in again."),
      "oauth_state",
    );
    assert.equal(
      toLoginErrorCode("Google sign-in isn’t configured yet (needs GOOGLE_OAUTH_CLIENT_ID)."),
      "oauth_config",
    );
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

describe("resolveEmailPasswordBackend", () => {
  it("prefers Supabase when configured so existing Auth users keep working", () => {
    assert.equal(
      resolveEmailPasswordBackend({
        supabaseConfigured: true,
        betterAuthEmailEnabled: true,
      }),
      "supabase",
    );
  });

  it("uses Better Auth email only when Supabase env is absent", () => {
    assert.equal(
      resolveEmailPasswordBackend({
        supabaseConfigured: false,
        betterAuthEmailEnabled: true,
      }),
      "better_auth",
    );
  });

  it("returns none when neither backend is available", () => {
    assert.equal(
      resolveEmailPasswordBackend({
        supabaseConfigured: false,
        betterAuthEmailEnabled: false,
      }),
      "none",
    );
  });
});


describe("serverFnRedirectHref", () => {
  it("reads href from a serialized serverFn redirect object", () => {
    assert.equal(
      serverFnRedirectHref({
        href: "/dashboard",
        statusCode: 307,
        isSerializedRedirect: true,
      }),
      "/dashboard",
    );
  });

  it("reads href from a thrown Response with Location", () => {
    const res = new Response(null, {
      status: 307,
      headers: { Location: "/dashboard" },
    });
    assert.equal(serverFnRedirectHref(res), "/dashboard");
  });

  it("reads href nested under error (createServerFn shape)", () => {
    assert.equal(
      serverFnRedirectHref({
        error: { href: "/login", statusCode: 307, isSerializedRedirect: true },
      }),
      "/login",
    );
  });

  it("returns null for ordinary errors", () => {
    assert.equal(serverFnRedirectHref(new Error("nope")), null);
    assert.equal(serverFnRedirectHref("x"), null);
  });
});

describe("authUserLoaderFallback", () => {
  it("keeps configured true so a transient serverFn failure cannot paint not-configured", () => {
    const fallback = authUserLoaderFallback(new Error("boom"));
    assert.equal(fallback.configured, true);
    assert.equal(fallback.user, null);
    assert.deepEqual(fallback.supabaseOAuthProviders, ["google", "github"]);
  });
});

describe("formatLoginThrownError", () => {
  it("prefers Error.message over the generic Something went wrong copy", () => {
    assert.equal(formatLoginThrownError(new Error("Invalid login credentials")), "Invalid login credentials");
  });

  it("stringifies unknown objects instead of a blank generic", () => {
    const msg = formatLoginThrownError({ code: "X", detail: "nope" });
    assert.match(msg, /nope|X/);
    assert.notEqual(msg, "Something went wrong.");
  });
});
