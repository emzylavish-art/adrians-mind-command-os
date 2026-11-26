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
    const result = await probeAuthUser();
    const decision = decideDashboardGate(result);
    if (decision.action === "redirect_login") {
      throw redirect({
        to: "/login",
        search: dashboardLoginSearch(),
      });
    }
    return decision.user;
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
    const supabase = createSupabaseServerClient();
    const origin = await requestOrigin();
    const redirectTo = buildAuthCallbackUrl(origin, data.next);
    const provider = data.provider as "google" | "github" | "apple";
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

/** End only this app's Supabase session; failures are reported before navigation. */
export const endSupabaseSession = createServerFn({ method: "POST" }).handler(async () => {
  const { readSupabaseEnv, createSupabaseServerClient } = await loadServer();
  if (!readSupabaseEnv()) return { ok: true as const };
  try {
    const { error } = await createSupabaseServerClient().auth.signOut();
    if (error) return { ok: false as const, error: "The account session could not be ended. Please try again." };
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "The account session could not be ended. Please try again." };
  }
});

export const signOutSupabase = createServerFn({ method: "POST" }).handler(async () => {
  const result = await endSupabaseSession();
  if (!result.ok) throw new Error(result.error);
  throw redirect({ to: "/login" });
});
