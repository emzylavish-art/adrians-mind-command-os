/**
 * Mutable OAuth callback redirects for TanStack Start + Nitro.
 *
 * Never use `Response.redirect()` here: undici freezes those headers, and
 * Start's mergeEventResponseHeaders then throws `TypeError: immutable` when
 * attaching Supabase Set-Cookie after exchangeCodeForSession (unhandled 500).
 */
export function oauthCallbackRedirect(absoluteUrl: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: absoluteUrl },
  });
}
