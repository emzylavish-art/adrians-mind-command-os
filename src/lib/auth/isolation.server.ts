import { getRequest } from "@tanstack/react-start/server";
import { decideFetchSite } from "@/lib/mind/request-guard";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). If it is imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
 * UNTRUSTED. In-app / embedded browsers may label first-party fetches as
 * `Sec-Fetch-Site: cross-site`; we still allow those when Origin is our prod or
 * `*-adrian-8a30.vercel.app` preview host (see `decideFetchSite`).
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  const h = request.headers;
  const decision = decideFetchSite({
    site: h.get("sec-fetch-site"),
    mode: h.get("sec-fetch-mode"),
    dest: h.get("sec-fetch-dest"),
    method: request.method,
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
  });
  if (decision === "block") throw new CrossSiteRequestError();
}
