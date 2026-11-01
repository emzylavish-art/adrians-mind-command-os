/** Same-origin CSRF check for cookie-authenticated mutations (OAuth + MCP). */
export function assertSameOrigin(request: Request): { ok: true } | { ok: false; error: string } {
  const blocked = { ok: false as const, error: "Cross-origin request blocked." };

  // Fetch Metadata: browsers set Sec-Fetch-Site on scripted requests.
  // Allow same-origin and "none" (user-initiated / opaque); reject cross-site
  // and same-site siblings (*.grok.me mutual distrust).
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return blocked;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const url = new URL(request.url);
  const expected = url.origin;
  if (origin) {
    if (origin !== expected) return blocked;
    return { ok: true };
  }
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) return blocked;
      return { ok: true };
    } catch {
      return blocked;
    }
  }
  // Non-browser clients (tests, curl with bearer) — allow when Origin/Referer absent.
  return { ok: true };
}
