/** Restrict Ollama base URLs to loopback unless explicitly allowed. */

export const OLLAMA_BASE_REJECTED =
  "The Ollama host is not allowed. Orchestrator only contacts localhost (127.0.0.1 / ::1) unless MIND_OLLAMA_ALLOW_REMOTE is enabled. Nothing was sent.";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Returns a normalized http(s) base URL, or null when unsafe.
 * Default policy: only loopback. Set allowRemote true (e.g. MIND_OLLAMA_ALLOW_REMOTE=1) to permit other hosts.
 */
export function resolveSafeOllamaBase(
  raw: string | null | undefined,
  options: { allowRemote?: boolean; fallback?: string } = {},
): { ok: true; base: string } | { ok: false; error: string } {
  const fallback = options.fallback ?? "http://127.0.0.1:11434";
  const candidate = (raw && raw.trim()) || fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: OLLAMA_BASE_REJECTED };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: OLLAMA_BASE_REJECTED };
  }
  if (!options.allowRemote && !isLoopbackHostname(url.hostname)) {
    return { ok: false, error: OLLAMA_BASE_REJECTED };
  }
  // Strip path/query/hash — conductor appends /api/chat|/api/tags
  const base = `${url.protocol}//${url.host}`;
  return { ok: true, base };
}

export function ollamaAllowRemoteFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.MIND_OLLAMA_ALLOW_REMOTE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
