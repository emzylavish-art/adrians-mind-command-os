/**
 * Build the OAuth / email-confirm redirectTo from the live request origin.
 * Preview deployments must not hard-code production hostnames.
 */
import { safeRedirectPath } from "./safe-redirect.ts";

export function buildAuthCallbackUrl(
  origin: string,
  next?: string | null,
): string {
  const path = safeRedirectPath(next);
  // origin is expected to be protocol+host (no trailing slash), e.g. https://preview-….vercel.app
  const base = origin.replace(/\/$/, "");
  return `${base}/auth/callback?next=${encodeURIComponent(path)}`;
}

/**
 * startOAuth returns `{ ok: true, url }`; the browser must follow it.
 * Only https Supabase authorize URLs are followed (never arbitrary hosts).
 */
export function oauthAuthorizeTarget(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { ok?: unknown; url?: unknown };
  if (r.ok !== true || typeof r.url !== "string") return null;
  try {
    const u = new URL(r.url);
    if (u.protocol !== "https:") return null;
    if (!u.pathname.endsWith("/auth/v1/authorize")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
