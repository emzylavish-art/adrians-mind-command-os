/** Allowlist for browser navigation after startOAuth (never *.supabase.co). */
export function isFirstPartyAuthorizeUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "https:") return false;
    if (
      u.hostname === "accounts.google.com" &&
      (u.pathname === "/o/oauth2/v2/auth" || u.pathname === "/o/oauth2/auth")
    ) {
      return true;
    }
    if (
      u.hostname === "github.com" &&
      u.pathname === "/login/oauth/authorize"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
