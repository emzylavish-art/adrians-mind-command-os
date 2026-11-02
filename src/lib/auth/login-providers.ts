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

export type EmailPasswordBackend = "supabase" | "better_auth" | "none";

/**
 * Prefer Supabase email/password when configured so existing Auth users keep
 * working. Fall back to Better Auth local email only when Supabase env is absent.
 * (4371f0e had flipped /login to Better Auth-first; live E2E users are on Supabase.)
 */
export function resolveEmailPasswordBackend(input: {
  supabaseConfigured: boolean;
  betterAuthEmailEnabled: boolean;
}): EmailPasswordBackend {
  if (input.supabaseConfigured) return "supabase";
  if (input.betterAuthEmailEnabled) return "better_auth";
  return "none";
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

/**
 * Red danger banner must never appear from a URL query alone (stale links,
 * session restore, or a bounce that left ?error=). Only in-page failed attempts
 * set the danger banner.
 */
export function loginErrorBannerFromSearch(
  _error: string | undefined,
): string | null {
  return null;
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


/**
 * Resolve a navigation href from a TanStack serverFn redirect — whether thrown
 * as a Response, returned as a serialized redirect object, or nested under
 * `{ error: { isSerializedRedirect, href } }`.
 */
export function serverFnRedirectHref(value: unknown): string | null {
  if (value == null) return null;
  if (typeof Response !== "undefined" && value instanceof Response) {
    const header = value.headers.get("Location");
    if (header) return header;
    const opts = (value as { options?: { href?: string } }).options;
    if (opts && typeof opts.href === "string" && opts.href) return opts.href;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.isSerializedRedirect === true && typeof obj.href === "string" && obj.href) {
      return obj.href;
    }
    // createServerFn sometimes surfaces the redirect on `.error`
    if ("error" in obj) {
      const nested = serverFnRedirectHref(obj.error);
      if (nested) return nested;
    }
    if ("result" in obj) {
      const nested = serverFnRedirectHref(obj.result);
      if (nested) return nested;
    }
  }
  return null;
}

/** Loader catch must never claim Supabase is unconfigured (false banner). */
export function authUserLoaderFallback(err?: unknown): {
  configured: true;
  user: null;
  brokerConfigured: false;
  supabaseOAuthProviders: [];
} {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[login] getSupabaseAuthUser failed; keeping configured=true", err);
  }
  return {
    configured: true,
    user: null,
    brokerConfigured: false,
    supabaseOAuthProviders: [],
  };
}

/** Honest banner text for non-redirect failures (never blank "Something went wrong."). */
export function formatLoginThrownError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return `Sign-in failed (HTTP ${status}).`;
  }
  if (typeof Response !== "undefined" && err instanceof Response) {
    return `Sign-in failed (HTTP ${err.status}).`;
  }
  try {
    const raw = JSON.stringify(err);
    if (raw && raw !== "{}" && raw !== "null") return raw.slice(0, 240);
  } catch {
    /* ignore */
  }
  return "Sign-in failed.";
}
