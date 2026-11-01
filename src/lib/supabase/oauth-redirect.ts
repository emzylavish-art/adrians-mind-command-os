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
