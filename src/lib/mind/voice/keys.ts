/**
 * Server-only voice key resolution. Never log or return the raw key to clients.
 */
export function resolveVoiceApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const primary = env.XAI_VOICE_API_KEY?.trim();
  if (primary) return primary;
  const legacy = env.VOICE_API_KEY?.trim();
  return legacy || undefined;
}

export function voiceKeyConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(resolveVoiceApiKey(env));
}
