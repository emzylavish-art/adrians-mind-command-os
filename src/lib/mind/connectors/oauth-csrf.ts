/** Same-origin CSRF check for cookie-authenticated OAuth mutations. */
export function assertSameOrigin(request: Request): { ok: true } | { ok: false; error: string } {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const url = new URL(request.url);
  const expected = url.origin;
  if (origin) {
    if (origin !== expected) {
      return { ok: false, error: "Cross-origin OAuth request blocked." };
    }
    return { ok: true };
  }
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) {
        return { ok: false, error: "Cross-origin OAuth request blocked." };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Cross-origin OAuth request blocked." };
    }
  }
  // Non-browser clients (tests, curl with bearer) — allow when Origin/Referer absent.
  return { ok: true };
}
