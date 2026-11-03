/**
 * Supabase Auth server functions — password, OAuth start, session probe, sign-out.
 * Session cookies are written only on the server (HttpOnly).
 */
import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { safeRedirectPath } from "./safe-redirect";
import { buildAuthCallbackUrl } from "./oauth-redirect";
import { decideDashboardGate, type SupabaseGateUser } from "./gate";
import {
  dashboardLoginSearch,
  isOwnerBrokerConfigured,
  parseSupabaseOAuthProviders,
  type SupabaseOAuthProviderId,
} from "@/lib/auth/login-providers";

function asString(value: unknown, max = 320): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function loadServer() {
  return import("./server");
}

async function requestOrigin(): Promise<string> {
  const { getRequestUrl } = await import("@tanstack/react-start/server");
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  return url.origin;
}

function probeBrokerConfigured(): boolean {
  return isOwnerBrokerConfigured({
    VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED,
    GROK_AUTH_CLIENT_ID: process.env.GROK_AUTH_CLIENT_ID,
    GROK_AUTH_CLIENT_SECRET: process.env.GROK_AUTH_CLIENT_SECRET,
  });
}

function probeSupabaseOAuthProviders(): SupabaseOAuthProviderId[] {
  return parseSupabaseOAuthProviders(process.env.SUPABASE_OAUTH_PROVIDERS);
}

async function probeAuthUser(): Promise<{
  configured: boolean;
  user: SupabaseGateUser | null;
  brokerConfigured: boolean;
  supabaseOAuthProviders: SupabaseOAuthProviderId[];
}> {
  const brokerConfigured = probeBrokerConfigured();
  const supabaseOAuthProviders = probeSupabaseOAuthProviders();
  const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
  if (!readSupabaseEnv()) {
    return { configured: false, user: null, brokerConfigured, supabaseOAuthProviders };
  }
  const supabase = createSupabaseServerClient();
  // Prefer getUser() over getSession() — validates the JWT with the Auth server.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { configured: true, user: null, brokerConfigured, supabaseOAuthProviders };
  }
  return {
    configured: true,
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
    },
    brokerConfigured,
    supabaseOAuthProviders,
  };
}

export type AuthUserResult = {
  configured: boolean;
  user: SupabaseGateUser | null;
  brokerConfigured: boolean;
  supabaseOAuthProviders: SupabaseOAuthProviderId[];
};

export const getSupabaseAuthUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUserResult> => probeAuthUser(),
);

export const requireDashboardUser = createServerFn({ method: "GET" }).handler(
  async () => {
    // Dynamic import keeps *.server modules out of the client graph (TanStack
    // Start import-protection). Accepts Better Auth or Supabase sessions.
    const { getSessionUser } = await import("@/lib/auth/verify.server");
    const user = await getSessionUser();
    if (!user) {
      throw redirect({
        to: "/login",
        search: dashboardLoginSearch(),
      });
    }
    return { id: user.id, email: user.email ?? null };
  },
);

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: { email?: string; password?: string; next?: string }) => ({
    email: asString(input.email, 320),
    password: asString(input.password, 200),
    next: safeRedirectPath(asString(input.next, 400) || undefined),
  }))
  .handler(async ({ data }) => {
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (!readSupabaseEnv()) {
      return {
        ok: false as const,
        error: "Sign-in isn't configured yet.",
      };
    }
    if (!data.email || !data.password) {
      return { ok: false as const, error: "Email and password are required." };
    }
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error) {
      return {
        ok: false as const,
        error: error.message || "Sign-in failed.",
      };
    }
    throw redirect({ href: data.next });
  });

export const signUpWithPassword = createServerFn({ method: "POST" })
  .validator((input: { email?: string; password?: string; next?: string }) => ({
    email: asString(input.email, 320),
    password: asString(input.password, 200),
    next: safeRedirectPath(asString(input.next, 400) || undefined),
  }))
  .handler(async ({ data }) => {
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (!readSupabaseEnv()) {
      return {
        ok: false as const,
        error: "Sign-in isn't configured yet.",
      };
    }
    if (!data.email || !data.password) {
      return { ok: false as const, error: "Email and password are required." };
    }
    if (data.password.length < 8) {
      return {
        ok: false as const,
        error: "Use a password with at least 8 characters.",
      };
    }
    const supabase = createSupabaseServerClient();
    const origin = await requestOrigin();
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: buildAuthCallbackUrl(origin, data.next),
      },
    });
    if (error) {
      return {
        ok: false as const,
        error: error.message || "Sign-up failed.",
      };
    }
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      throw redirect({ href: data.next });
    }
    return {
      ok: true as const,
      needsConfirm: true as const,
      message: "Check your email to confirm your account, then sign in.",
    };
  });

export const startOAuth = createServerFn({ method: "POST" })
  .validator(
    (input: {
      provider?: string;
      next?: string;
    }) => {
      const provider = asString(input.provider, 32);
      const allowed =
        provider === "google" ||
        provider === "github" ||
        provider === "apple"
          ? provider
          : null;
      return {
        provider: allowed,
        next: safeRedirectPath(asString(input.next, 400) || undefined),
      };
    },
  )
  .handler(async ({ data }) => {
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (!readSupabaseEnv()) {
      return {
        ok: false as const,
        error: "Sign-in isn't configured yet.",
      };
    }
    if (!data.provider) {
      return { ok: false as const, error: "Unknown sign-in provider." };
    }
    const origin = await requestOrigin();
    const provider = data.provider as "google" | "github" | "apple";

    // Google/GitHub: first-party OAuth so the browser never hits *.supabase.co
    // (some mobile carriers' DNS cannot resolve project.supabase.co).
    if (provider === "google" || provider === "github") {
      const { startFirstPartyOAuth } = await import(
        "./first-party-oauth.server"
      );
      return startFirstPartyOAuth({
        provider,
        next: data.next,
        origin,
      });
    }

    // Apple (and any remaining Supabase-hosted providers) keep the old hop.
    const supabase = createSupabaseServerClient();
    const redirectTo = buildAuthCallbackUrl(origin, data.next);
    const { data: oauth, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error || !oauth?.url) {
      return {
        ok: false as const,
        error: error?.message || "Could not start provider sign-in.",
      };
    }
    return { ok: true as const, url: oauth.url };
  });

export const signOutSupabase = createServerFn({ method: "POST" }).handler(
  async () => {
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (readSupabaseEnv()) {
      try {
        const supabase = createSupabaseServerClient();
        await supabase.auth.signOut();
      } catch {
        // Still send the visitor to login even if sign-out errors.
      }
    }
    throw redirect({ to: "/login" });
  },
);


/**
 * Request a recovery email. Always returns a neutral success when configured
 * so we never leak whether the address has an account. Runs only on the server
 * (browser never calls *.supabase.co). Prefers admin generateLink recovery so
 * we can exercise the recovery token path; still triggers Supabase's mailer via
 * resetPasswordForEmail for delivery.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: { email?: string }) => ({
    email: asString(input.email, 320).toLowerCase(),
  }))
  .handler(async ({ data }) => {
    const {
      PASSWORD_RESET_REDIRECT,
      PASSWORD_RESET_REQUEST_NEUTRAL,
    } = await import("./password-reset");
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (!readSupabaseEnv()) {
      return {
        ok: false as const,
        error: "Sign-in isn't configured yet.",
      };
    }
    if (!data.email || !data.email.includes("@")) {
      return {
        ok: false as const,
        error: "Enter a valid email address.",
      };
    }

    try {
      const { createSupabaseAdminClient } = await import("./admin.server");
      const admin = createSupabaseAdminClient();
      await admin.auth.admin.generateLink({
        type: "recovery",
        email: data.email,
        options: { redirectTo: PASSWORD_RESET_REDIRECT },
      });
    } catch {
      /* service role optional for request path */
    }

    try {
      const supabase = createSupabaseServerClient();
      await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: PASSWORD_RESET_REDIRECT,
      });
    } catch {
      /* still neutral */
    }

    return {
      ok: true as const,
      message: PASSWORD_RESET_REQUEST_NEUTRAL,
    };
  });

/**
 * Complete recovery: verifyOtp(recovery) with token_hash (or exchange PKCE code),
 * then update the password. Entirely server-side.
 */
export const completePasswordReset = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tokenHash?: string;
      code?: string;
      password?: string;
      type?: string;
    }) => ({
      tokenHash: asString(input.tokenHash, 512),
      code: asString(input.code, 512),
      password: asString(input.password, 200),
      type: asString(input.type, 32) || "recovery",
    }),
  )
  .handler(async ({ data }) => {
    const {
      PASSWORD_RESET_INVALID_LINK,
      validateNewPassword,
    } = await import("./password-reset");
    const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
    if (!readSupabaseEnv()) {
      return {
        ok: false as const,
        error: "Sign-in isn't configured yet.",
      };
    }
    const passwordCheck = validateNewPassword(data.password);
    if (!passwordCheck.ok) {
      return { ok: false as const, error: passwordCheck.error };
    }
    if (!data.tokenHash && !data.code) {
      return { ok: false as const, error: PASSWORD_RESET_INVALID_LINK };
    }

    const supabase = createSupabaseServerClient();

    if (data.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(data.code);
      if (error) {
        return { ok: false as const, error: PASSWORD_RESET_INVALID_LINK };
      }
    } else {
      const type =
        data.type === "recovery" ||
        data.type === "email" ||
        data.type === "magiclink"
          ? (data.type as "recovery" | "email" | "magiclink")
          : "recovery";
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: data.tokenHash,
      });
      if (error) {
        return { ok: false as const, error: PASSWORD_RESET_INVALID_LINK };
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: data.password,
    });
    if (updateError) {
      return {
        ok: false as const,
        error: updateError.message || "Could not update password.",
      };
    }

    throw redirect({ href: "/dashboard" });
  });
