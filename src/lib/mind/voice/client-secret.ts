import { resolveVoiceApiKey } from "./keys.ts";

export const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

export type ClientSecretResult =
  | { ok: true; value: string; expiresAt: number }
  | { ok: false; error: string };

/**
 * Mint an ephemeral realtime client secret using the server voice key.
 * The returned value is short-lived and safe to hand to the browser.
 */
export async function mintRealtimeClientSecret(input: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  expiresSeconds?: number;
}): Promise<ClientSecretResult> {
  const apiKey = resolveVoiceApiKey(input.env ?? process.env);
  if (!apiKey) {
    return {
      ok: false,
      error: "No speech key is configured. The chat key is not used for voice. Nothing was started.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        expires_after: { seconds: input.expiresSeconds ?? 300 },
        session: { model: "grok-voice-latest" },
      }),
    });
  } catch {
    return { ok: false, error: "Voice secret service did not answer in time." };
  }
  if (!response.ok) {
    return { ok: false, error: `Voice secret service returned ${response.status}.` };
  }
  const payload = (await response.json()) as { value?: string; expires_at?: number };
  if (!payload.value) return { ok: false, error: "Voice secret service returned no token." };
  return { ok: true, value: payload.value, expiresAt: payload.expires_at ?? 0 };
}
