/**
 * Scrub secrets from terminal output and agent logs before they leave the laptop
 * or are reported to the dashboard.
 */
const PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[^\s"'\\]+/gi,
  /\bMIND_PAIRING_MANAGEMENT_KEY\b\s*[:=]\s*\S+/gi,
  /\b-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT-ish
  /[A-Za-z0-9+/]{40,}={0,2}/g, // long base64 blobs (conservative: only if labeled nearby handled above)
];

export function redactSecretsFromOutput(text: string): string {
  if (!text) return text;
  let out = text;
  // Apply specific patterns first; skip the overly broad base64 for short lines
  for (const pattern of PATTERNS.slice(0, 5)) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function safeLogLine(message: string): string {
  return redactSecretsFromOutput(message).slice(0, 2000);
}
