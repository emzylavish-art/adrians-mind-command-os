/**
 * First-party Google/GitHub OAuth helpers (browser never touches *.supabase.co).
 * Authorize URLs point at accounts.google.com / github.com; callbacks live on our origin.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { safeRedirectPath } from "./safe-redirect.ts";

export type FirstPartyOAuthProvider = "google" | "github";

export type OAuthStatePayload = {
  p: FirstPartyOAuthProvider;
  n: string;
  i: string;
  e: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export function oauthStateCookieName(): string {
  return "am_oauth_state";
}

export function encodeOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function decodeOAuthState(
  state: string,
  secret: string,
  nowMs = Date.now(),
): OAuthStatePayload | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
    if (parsed.p !== "google" && parsed.p !== "github") return null;
    if (typeof parsed.i !== "string" || !parsed.i) return null;
    if (typeof parsed.e !== "number" || parsed.e < nowMs) return null;
    return {
      p: parsed.p,
      n: safeRedirectPath(typeof parsed.n === "string" ? parsed.n : undefined),
      i: parsed.i,
      e: parsed.e,
    };
  } catch {
    return null;
  }
}

export function mintOAuthState(
  provider: FirstPartyOAuthProvider,
  next: string,
  secret: string,
  nowMs = Date.now(),
  id = randomStateId(),
): { state: string; payload: OAuthStatePayload } {
  const payload: OAuthStatePayload = {
    p: provider,
    n: safeRedirectPath(next),
    i: id,
    e: nowMs + STATE_TTL_MS,
  };
  return { state: encodeOAuthState(payload, secret), payload };
}

function randomStateId(): string {
  return randomBytes(16).toString("hex");
}

export function buildGoogleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", input.state);
  u.searchParams.set("access_type", "online");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export function buildGitHubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("scope", "user:email");
  u.searchParams.set("state", input.state);
  return u.toString();
}

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
