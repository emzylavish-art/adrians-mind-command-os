/** Honest copy + DEV helpers when the realtime speech provider key is missing. */

export function providerUnconfiguredMessage(): string {
  return "No speech key is configured. The chat key is not used for voice. Nothing was started.";
}

/**
 * Dev-only e2e hook: `?voiceForceUnconfigured=1` forces the overlay onto the
 * provider-not-configured error path without stubbing TanStack server functions.
 */
export function shouldForceVoiceUnconfigured(search: string, isDev: boolean): boolean {
  if (!isDev) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const v = params.get("voiceForceUnconfigured");
  return v === "1" || v === "true";
}
