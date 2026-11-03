/**
 * Build the OAuth / email-confirm redirectTo from the live request origin.
 * Preview deployments must not hard-code production hostnames.
 */
import { safeRedirectPath } from "./safe-redirect.ts";
import { isFirstPartyAuthorizeUrl } from "./first-party-oauth.ts";

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
 * Prefer first-party Google/GitHub authorize hosts (never *.supabase.co for those).
 * Apple may still use Supabase `/auth/v1/authorize` until configured separately.
 */
export function oauthAuthorizeTarget(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { ok?: unknown; url?: unknown };
  if (r.ok !== true || typeof r.url !== "string") return null;
  try {
    const u = new URL(r.url);
    if (u.protocol !== "https:") return null;
    if (isFirstPartyAuthorizeUrl(u.toString())) return u.toString();
    // Legacy Supabase-hosted authorize (Apple / transitional).
    if (u.hostname.endsWith(".supabase.co") && u.pathname.endsWith("/auth/v1/authorize")) {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}
