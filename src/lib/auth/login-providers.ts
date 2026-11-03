/**
 * Decide how each login button should behave on the unified /login surface.
 * Supabase owns email + Google/GitHub/Apple when configured; Better Auth (broker)
 * keeps Google/X working when Supabase env is missing. X always uses Better Auth.
 */
export type LoginProviderId = "google" | "github" | "apple" | "x";

export type LoginProviderAction =
  | { kind: "supabase_oauth"; provider: "google" | "github" | "apple" }
  | { kind: "better_auth"; providerId: string; label: string }
  | { kind: "not_configured"; message: string };

/** Supabase Auth OAuth providers enabled in the project (server env). Defaults to none. */
export type SupabaseOAuthProviderId = "google" | "github" | "apple";

export function parseSupabaseOAuthProviders(
  raw: string | undefined | null,
): SupabaseOAuthProviderId[] {
  const allowed = new Set<SupabaseOAuthProviderId>(["google", "github", "apple"]);
  const out: SupabaseOAuthProviderId[] = [];
  for (const part of String(raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    if (allowed.has(part as SupabaseOAuthProviderId) && !out.includes(part as SupabaseOAuthProviderId)) {
      out.push(part as SupabaseOAuthProviderId);
    }
  }
  return out;
}

export function resolveLoginProviderAction(
  provider: LoginProviderId,
  input: {
    supabaseConfigured: boolean;
    betterAuthEnabled: boolean;
    /** Empty / omitted = no Supabase OAuth providers enabled (honest disabled buttons). */
    supabaseOAuthProviders?: readonly SupabaseOAuthProviderId[];
  },
): LoginProviderAction {
  if (provider === "x") {
    if (!input.betterAuthEnabled) {
      return {
        kind: "not_configured",
        message:
          "Continue with X isn’t configured yet (needs VITE_AUTH_ENABLED and GROK_AUTH_CLIENT_ID / GROK_AUTH_CLIENT_SECRET).",
      };
    }
    return { kind: "better_auth", providerId: "grok-x", label: "X" };
  }

  const supabaseOauth =
    input.supabaseConfigured &&
    (input.supabaseOAuthProviders ?? []).includes(provider as SupabaseOAuthProviderId);

  if (supabaseOauth) {
    return {
      kind: "supabase_oauth",
      provider: provider as "google" | "github" | "apple",
    };
  }

  if (provider === "google" && input.betterAuthEnabled) {
    return { kind: "better_auth", providerId: "grok-google", label: "Google" };
  }

  if (input.supabaseConfigured) {
    return {
      kind: "not_configured",
      message: "Not enabled yet",
    };
  }

  const needs =
    provider === "github"
      ? "Supabase Auth GitHub provider (and SUPABASE_URL + SUPABASE_ANON_KEY)"
      : provider === "apple"
        ? "Supabase Auth Apple provider (and SUPABASE_URL + SUPABASE_ANON_KEY)"
        : "Supabase Auth Google provider, or GROK_AUTH_CLIENT_ID / GROK_AUTH_CLIENT_SECRET for broker Google";

  return {
    kind: "not_configured",
    message: `Continue with ${provider[0]!.toUpperCase()}${provider.slice(1)} isn’t configured yet (needs ${needs}).`,
  };
}

export function emailPasswordGate(supabaseConfigured: boolean): {
  ok: true
} | { ok: false; message: string } {
  if (supabaseConfigured) return { ok: true };
  return {
    ok: false,
    message:
      "Email sign-in isn’t configured yet (needs SUPABASE_URL and SUPABASE_ANON_KEY on the server).",
  };
}

/** Last OAuth provider attempted on /login (sessionStorage; Retry fidelity). */
export const LOGIN_LAST_OAUTH_PROVIDER_KEY = "adrian.login.lastOauthProvider";

export type LoginCallbackFailureKind = "auth_error" | "server_error";

export type LoginCallbackFailure = {
  kind: LoginCallbackFailureKind;
  /** One-line description for the red login banner. */
  message: string;
};

/**
 * Classify /auth/callback → /login?error= (and Better Auth errorCallback) copy.
 * Bare noise ("", "1") stays silent so stale restore / broker flags do not paint red.
 * Real auth vs server failures become a red retryable banner.
 */
export function classifyLoginCallbackError(
  error: string | undefined,
): LoginCallbackFailure | null {
  const raw = String(error ?? "").trim();
  if (!raw || raw === "1") return null;
  const message = raw.slice(0, 240);
  if (
    /immutable|TypeError|Internal Server Error|HTTP\s*5\d\d|ECONNRESET|ENOTFOUND|mergeEventResponseHeaders|Unexpected token|server error/i.test(
      raw,
    )
  ) {
    return { kind: "server_error", message };
  }
  return { kind: "auth_error", message };
}

/** Seed the red login banner from a real callback/auth error query (not noise). */
export function loginErrorBannerFromSearch(
  error: string | undefined,
): string | null {
  return classifyLoginCallbackError(error)?.message ?? null;
}

export function loginCallbackFailureKind(
  error: string | undefined,
): LoginCallbackFailureKind | null {
  return classifyLoginCallbackError(error)?.kind ?? null;
}

/** /dashboard → /login search params. Never append error. */
export function dashboardLoginSearch(): { next: "/dashboard" } {
  return { next: "/dashboard" };
}

/** Owner-broker Google/X are usable only when real GROK_AUTH_* env is set. */
export function isOwnerBrokerConfigured(env: {
  VITE_AUTH_ENABLED?: string;
  GROK_AUTH_CLIENT_ID?: string;
  GROK_AUTH_CLIENT_SECRET?: string;
}): boolean {
  if ((env.VITE_AUTH_ENABLED ?? "").trim() === "false") return false;
  const id = (env.GROK_AUTH_CLIENT_ID ?? "").trim();
  const secret = (env.GROK_AUTH_CLIENT_SECRET ?? "").trim();
  return Boolean(id && secret);
}
