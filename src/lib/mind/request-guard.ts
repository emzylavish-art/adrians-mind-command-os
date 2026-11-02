/**
 * Fetch-Metadata + Origin allowlist for cookie-authenticated mutations
 * (authMiddleware / turn / agent-run / media). MCP OAuth routes keep using
 * `assertSameOrigin` in connectors/oauth-csrf.ts (stricter; unchanged).
 *
 * Allows: same-origin / none / missing Sec-Fetch-Site, top-level GET navigations,
 * same-site when Origin host matches the request host or our app allowlist, and
 * embedded/in-app browsers that label first-party fetches cross-site while still
 * sending our app Origin (prod + *-adrian-8a30.vercel.app + localhost).
 * Blocks foreign Origins and same-site/cross-site requests we cannot attribute.
 */

export type FetchSiteDecision = "allow" | "block";

export type DecideFetchSiteInput = {
  site: string | null;
  mode: string | null;
  dest: string | null;
  method: string;
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
};

const PROD_HOST = "adrians-mind.vercel.app";
const PREVIEW_HOST_RE = /^[a-z0-9-]+-adrian-8a30\.vercel\.app$/i;

export function isAllowedAppHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (h === PROD_HOST) return true;
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (PREVIEW_HOST_RE.test(h)) return true;
  return false;
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHostHeader(raw: string | null | undefined): string {
  if (!raw) return "";
  const first = raw.split(",")[0]?.trim() ?? "";
  return first.replace(/:\d+$/, "").toLowerCase();
}

function originIsOurs(
  origin: string,
  reqHost: string,
): boolean {
  const originHost = hostnameFromOrigin(origin);
  if (!originHost) return false;
  if (!isAllowedAppHost(originHost)) return false;
  // Prefer exact Host / x-forwarded-host match; else allowlisted Origin alone
  // (some embeds omit or rewrite Host).
  if (!reqHost || reqHost === originHost || isAllowedAppHost(reqHost)) return true;
  return false;
}

export function decideFetchSite(input: DecideFetchSiteInput): FetchSiteDecision {
  const site = input.site;
  if (!site || site === "same-origin" || site === "none") return "allow";

  const topLevelGet =
    input.mode === "navigate" &&
    input.method === "GET" &&
    input.dest !== "object" &&
    input.dest !== "embed";
  if (topLevelGet) return "allow";

  const origin = (input.origin ?? "").trim();
  const reqHost =
    normalizeHostHeader(input.forwardedHost) || normalizeHostHeader(input.host);

  // same-site: allow only when Origin host matches request host or allowlist.
  if (site === "same-site") {
    if (origin && originIsOurs(origin, reqHost)) return "allow";
    return "block";
  }

  // cross-site: allow only our allowlisted Origin (in-app / embedded browsers).
  // Foreign Origin stays blocked (CSRF).
  if (site === "cross-site") {
    if (origin && originIsOurs(origin, reqHost)) return "allow";
    return "block";
  }

  return "block";
}
