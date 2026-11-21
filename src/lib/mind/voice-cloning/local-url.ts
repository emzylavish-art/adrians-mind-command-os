/**
 * Resolve and harden the local voice-clone engine base URL.
 * Default loopback only — mirrors ollama-host policy.
 */
import { isLoopbackHostname } from "../voice/ollama-host.ts";

export const DEFAULT_VOICE_CLONE_LOCAL_URL = "http://127.0.0.1:7860";

export const LOCAL_URL_REJECTED =
  "The voice-clone engine URL is not allowed. Studio only contacts localhost (127.0.0.1 / ::1) unless VOICE_CLONE_ALLOW_REMOTE is enabled.";

export function voiceCloneAllowRemoteFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.VOICE_CLONE_ALLOW_REMOTE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function resolveVoiceCloneLocalUrl(
  raw: string | null | undefined,
  options: { allowRemote?: boolean; fallback?: string } = {},
): { ok: true; base: string } | { ok: false; error: string } {
  const fallback = options.fallback ?? DEFAULT_VOICE_CLONE_LOCAL_URL;
  const candidate = (raw && raw.trim()) || fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: LOCAL_URL_REJECTED };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: LOCAL_URL_REJECTED };
  }
  const allowRemote = options.allowRemote === true;
  if (!allowRemote && !isLoopbackHostname(url.hostname)) {
    return { ok: false, error: LOCAL_URL_REJECTED };
  }
  return { ok: true, base: `${url.protocol}//${url.host}` };
}

export function resolveVoiceCloneLocalUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): { ok: true; base: string } | { ok: false; error: string } {
  return resolveVoiceCloneLocalUrl(env.VOICE_CLONE_LOCAL_URL, {
    allowRemote: voiceCloneAllowRemoteFromEnv(env),
  });
}
