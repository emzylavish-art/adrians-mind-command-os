/**
 * Allow only same-origin relative paths for post-auth redirects.
 * Rejects protocol-relative URLs, absolute URLs, and backslash tricks.
 */

const DEFAULT_NEXT = "/dashboard";

export function safeRedirectPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof next !== "string") return fallback;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("://")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  if (trimmed.includes("\n") || trimmed.includes("\r")) return fallback;
  return trimmed;
}

export { DEFAULT_NEXT as SAFE_REDIRECT_DEFAULT };
