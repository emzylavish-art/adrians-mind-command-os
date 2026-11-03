/**
 * Inbound Host / Origin allowlist for local MCP (and related) HTTP endpoints.
 * Defeats DNS rebinding: a page on evil.com that resolves to this server still
 * fails because Host: evil.com is not on the app allowlist — even when Origin
 * matches the (attacker-controlled) request URL origin.
 */

/** Keep in sync with PREVIEW_ALLOWED_HOSTS in auth/preview (avoid importing auth secrets here). */
const PREVIEW_HOST_PATTERNS = ["*.grok-sandbox.com"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function stripPort(host: string): string {
  const h = host.trim().toLowerCase();
  if (!h) return "";
  // Bracketed IPv6 with optional port: [::1]:8080
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end > 0) return h.slice(0, end + 1);
  }
  // hostname:port — only split when it looks like host:digits (not bare IPv6)
  const m = /^(.+):(\d+)$/.exec(h);
  if (m && !m[1]!.includes(":")) return m[1]!;
  return h;
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const host = stripPort(hostname);
  const pat = pattern.toLowerCase();
  if (!host || !pat) return false;
  if (pat.startsWith("*.")) {
    const suffix = pat.slice(1); // .example.com
    const apex = pat.slice(2);
    return host === apex || host.endsWith(suffix);
  }
  return host === pat || host === stripPort(pat);
}

/**
 * Build the Host allowlist from env + built-in loopback + preview wildcards.
 * Extra hosts: MIND_ALLOWED_HOSTS (comma-separated), BETTER_AUTH_URL host.
 */
export function allowedRequestHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const hosts: string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];
  for (const pattern of PREVIEW_HOST_PATTERNS) hosts.push(pattern);

  const betterAuth = env.BETTER_AUTH_URL?.trim();
  if (betterAuth) {
    try {
      hosts.push(new URL(betterAuth).hostname);
    } catch {
      /* ignore bad BETTER_AUTH_URL */
    }
  }

  const extra = env.MIND_ALLOWED_HOSTS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const h = part.trim().toLowerCase();
      if (h) hosts.push(h);
    }
  }
  return hosts;
}

export function isAllowedRequestHost(
  hostname: string,
  allowlist: readonly string[] = allowedRequestHosts(),
): boolean {
  const host = stripPort(hostname);
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  return allowlist.some((pattern) => hostMatchesPattern(host, pattern));
}

/**
 * Validate inbound Host (and X-Forwarded-Host when present) against the allowlist.
 * Same-origin browser traffic to loopback / configured app hosts still passes.
 */
export function assertAllowedRequestHost(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; error: string } {
  const allowlist = allowedRequestHosts(env);
  const blocked = {
    ok: false as const,
    error: "Unexpected Host header. DNS-rebinding style requests are blocked.",
  };

  const hostHeader = request.headers.get("host");
  if (!hostHeader || !hostHeader.trim()) return blocked;
  if (!isAllowedRequestHost(hostHeader, allowlist)) return blocked;

  // If a proxy forwarded a host, that value must also be allowlisted (spoof resistance).
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (!first || !isAllowedRequestHost(first, allowlist)) return blocked;
  }

  return { ok: true };
}

/** Convenience: Host allowlist then same-origin CSRF. */
export function assertMcpHttpRequestGuards(
  request: Request,
  assertSameOrigin: (req: Request) => { ok: true } | { ok: false; error: string },
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; error: string } {
  const host = assertAllowedRequestHost(request, env);
  if (!host.ok) return host;
  return assertSameOrigin(request);
}
