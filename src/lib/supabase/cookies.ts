/**
 * Cookie attribute helpers for Supabase Auth session cookies.
 * Session tokens must be HttpOnly, SameSite=Lax, Secure in production.
 */

export type SessionCookieAttrs = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
};

/** Baseline attributes we require for auth session cookies. */
export function sessionCookieOptions(isProd: boolean): SessionCookieAttrs {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  };
}

export function isProductionRuntime(env: {
  NODE_ENV?: string;
  VERCEL?: string;
  MIND_ALLOW_INSECURE_COOKIES?: string;
}): boolean {
  // Local HTTP proof of a production build: allow non-Secure cookies when
  // explicitly opted in (never set on Vercel).
  if ((env.MIND_ALLOW_INSECURE_COOKIES ?? "").trim() === "1") return false;
  return env.NODE_ENV === "production" || env.VERCEL === "1";
}

/**
 * Merge Supabase SSR cookie options with our required security defaults.
 * Never weaken httpOnly / SameSite=Lax; Secure is on in production.
 */
export function mergeCookieOptions(
  incoming: Record<string, unknown> | undefined,
  isProd: boolean,
): Record<string, unknown> {
  const base = sessionCookieOptions(isProd);
  return {
    ...incoming,
    path: typeof incoming?.path === "string" ? incoming.path : base.path,
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(incoming?.secure) || base.secure,
  };
}

/** Assert the security shape used by unit tests (no network). */
export function requiredAuthCookieShape(isProd: boolean): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
} {
  const opts = sessionCookieOptions(isProd);
  return {
    httpOnly: opts.httpOnly,
    sameSite: opts.sameSite,
    secure: opts.secure,
  };
}
