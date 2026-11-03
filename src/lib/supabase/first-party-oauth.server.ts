/**
 * First-party Google / GitHub OAuth on adrians-mind.vercel.app.
 * Browser talks only to our origin + accounts.google.com / github.com.
 */
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import { createSupabaseAdminClient } from "./admin.server";
import { oauthCallbackRedirect } from "./oauth-callback-response";
import {
  buildGitHubAuthorizeUrl,
  buildGoogleAuthorizeUrl,
  decodeOAuthState,
  mintOAuthState,
  oauthStateCookieName,
  type FirstPartyOAuthProvider,
} from "./first-party-oauth";
import { toLoginErrorCode } from "@/lib/auth/login-providers";
import { safeRedirectPath } from "./safe-redirect";
import { createSupabaseServerClient, readSupabaseEnv } from "./server";

function envTrim(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function stateSecret(): string | null {
  return (
    envTrim("OAUTH_STATE_SECRET") ||
    envTrim("SUPABASE_JWT_SECRET") ||
    envTrim("BETTER_AUTH_SECRET") ||
    null
  );
}

export function readGoogleOAuthEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = envTrim("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envTrim("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function readGitHubOAuthEnv(): { clientId: string; clientSecret: string } | null {
  const clientId =
    envTrim("GITHUB_OAUTH_CLIENT_ID") || envTrim("GITHUB_CLIENT_ID");
  const clientSecret =
    envTrim("GITHUB_OAUTH_CLIENT_SECRET") || envTrim("GITHUB_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function callbackUri(origin: string, provider: FirstPartyOAuthProvider): string {
  return `${origin.replace(/\/$/, "")}/auth/${provider}/callback`;
}

function setStateCookie(state: string) {
  setCookie(oauthStateCookieName(), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });
}

function clearStateCookie() {
  deleteCookie(oauthStateCookieName(), { path: "/" });
}

export async function startFirstPartyOAuth(input: {
  provider: FirstPartyOAuthProvider;
  next: string;
  origin: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const secret = stateSecret();
  if (!secret) {
    return {
      ok: false,
      error: "OAuth state signing isn’t configured on the server.",
    };
  }
  const { state } = mintOAuthState(input.provider, input.next, secret);
  setStateCookie(state);
  const redirectUri = callbackUri(input.origin, input.provider);

  if (input.provider === "google") {
    const google = readGoogleOAuthEnv();
    if (!google) {
      return {
        ok: false,
        error:
          "Google sign-in isn’t configured yet (needs GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).",
      };
    }
    return {
      ok: true,
      url: buildGoogleAuthorizeUrl({
        clientId: google.clientId,
        redirectUri,
        state,
      }),
    };
  }

  const github = readGitHubOAuthEnv();
  if (!github) {
    return {
      ok: false,
      error:
        "GitHub sign-in isn’t configured yet (needs GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET).",
    };
  }
  return {
    ok: true,
    url: buildGitHubAuthorizeUrl({
      clientId: github.clientId,
      redirectUri,
      state,
    }),
  };
}

function loginErrorRedirect(
  origin: string,
  next: string,
  message: string,
): Response {
  clearStateCookie();
  const target = new URL("/login", origin);
  target.searchParams.set("next", safeRedirectPath(next));
  // Allowlisted code only — /login maps it to app-owned copy (no raw query text).
  target.searchParams.set("error", toLoginErrorCode(message));
  return oauthCallbackRedirect(target.toString());
}

async function establishSessionFromEmail(email: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    return error?.message || "Could not create a sign-in session.";
  }
  const supabase = createSupabaseServerClient();
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (otpError) return otpError.message || "Could not verify sign-in session.";
  return null;
}

async function exchangeGoogleCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{ idToken: string } | { error: string }> {
  const google = readGoogleOAuthEnv();
  if (!google) return { error: "Google OAuth isn’t configured." };
  const body = new URLSearchParams({
    code: input.code,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.id_token) {
    return {
      error:
        json.error_description ||
        json.error ||
        `Google token exchange failed (HTTP ${res.status}).`,
    };
  }
  return { idToken: json.id_token };
}

async function exchangeGitHubCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string } | { error: string }> {
  const github = readGitHubOAuthEnv();
  if (!github) return { error: "GitHub OAuth isn’t configured." };
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    return {
      error:
        json.error_description ||
        json.error ||
        `GitHub token exchange failed (HTTP ${res.status}).`,
    };
  }
  return { accessToken: json.access_token };
}

async function githubPrimaryEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "adrians-mind-command-os",
    },
  });
  if (!res.ok) return null;
  const emails = (await res.json()) as Array<{
    email?: string;
    primary?: boolean;
    verified?: boolean;
  }>;
  if (!Array.isArray(emails)) return null;
  const primary = emails.find((e) => e.primary && e.verified && e.email);
  if (primary?.email) return primary.email;
  const verified = emails.find((e) => e.verified && e.email);
  return verified?.email ?? null;
}

export async function handleFirstPartyOAuthCallback(input: {
  provider: FirstPartyOAuthProvider;
  request: Request;
}): Promise<Response> {
  const url = new URL(input.request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") || "";
  const providerError =
    url.searchParams.get("error_description") ||
    url.searchParams.get("error") ||
    "";

  const cookieState = getCookie(oauthStateCookieName()) || "";
  const secret = stateSecret();
  const nextFallback = "/dashboard";

  if (!secret) {
    return loginErrorRedirect(
      origin,
      nextFallback,
      "OAuth state signing isn’t configured on the server.",
    );
  }
  if (providerError) {
    return loginErrorRedirect(origin, nextFallback, providerError);
  }
  if (!code) {
    return loginErrorRedirect(origin, nextFallback, "Missing authorization code.");
  }
  if (!stateParam || !cookieState || stateParam !== cookieState) {
    return loginErrorRedirect(
      origin,
      nextFallback,
      "OAuth state mismatch. Start sign-in again.",
    );
  }
  const payload = decodeOAuthState(stateParam, secret);
  if (!payload || payload.p !== input.provider) {
    return loginErrorRedirect(
      origin,
      nextFallback,
      "OAuth state expired or invalid. Start sign-in again.",
    );
  }
  const next = payload.n;

  if (!readSupabaseEnv()) {
    return loginErrorRedirect(origin, next, "Sign-in isn’t configured yet.");
  }

  try {
    if (input.provider === "google") {
      const exchanged = await exchangeGoogleCode({
        code,
        redirectUri: callbackUri(origin, "google"),
      });
      if ("error" in exchanged) {
        return loginErrorRedirect(origin, next, exchanged.error);
      }
      const supabase = createSupabaseServerClient();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: exchanged.idToken,
      });
      if (error) {
        // Fallback: mint session from email claim if IdP token path fails.
        const email = emailFromJwt(exchanged.idToken);
        if (!email) {
          return loginErrorRedirect(
            origin,
            next,
            error.message || "Google sign-in failed.",
          );
        }
        const sessionError = await establishSessionFromEmail(email);
        if (sessionError) {
          return loginErrorRedirect(origin, next, sessionError);
        }
      }
    } else {
      const exchanged = await exchangeGitHubCode({
        code,
        redirectUri: callbackUri(origin, "github"),
      });
      if ("error" in exchanged) {
        return loginErrorRedirect(origin, next, exchanged.error);
      }
      const email = await githubPrimaryEmail(exchanged.accessToken);
      if (!email) {
        return loginErrorRedirect(
          origin,
          next,
          "GitHub did not return a verified email. Make the primary email public/verified, then try again.",
        );
      }
      const sessionError = await establishSessionFromEmail(email);
      if (sessionError) {
        return loginErrorRedirect(origin, next, sessionError);
      }
    }

    clearStateCookie();
    return oauthCallbackRedirect(new URL(next, origin).toString());
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim()
        ? err.message
        : "Could not complete provider sign-in.";
    return loginErrorRedirect(origin, next, message);
  }
}

/** Best-effort email from a Google ID token payload (no signature verify — already from token endpoint). */
function emailFromJwt(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { email?: string; email_verified?: boolean };
    if (payload.email && payload.email_verified !== false) return payload.email;
    return payload.email ?? null;
  } catch {
    return null;
  }
}

