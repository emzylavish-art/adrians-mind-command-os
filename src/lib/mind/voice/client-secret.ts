import { resolveVoiceApiKey } from "./keys.ts";

export const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

export type ClientSecretResult =
  | { ok: true; value: string; expiresAt: number }
  | { ok: false; error: string };

export function formatClientSecretHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return `Voice secret was refused (${status}). Check the speech key ACLs, then try Start voice again.`;
  }
  if (status === 429) {
    return "Voice secret rate limit hit (429). Wait a moment, then try Start voice again.";
  }
  if (status >= 500) {
    return `Voice secret service is unavailable (${status}). Try again in a moment.`;
  }
  return `Voice secret service returned ${status}.`;
}

/**
 * Mint an ephemeral realtime client secret using the server voice key.
 * The returned value is short-lived and safe to hand to the browser.
 * Body matches docs: expires_after only (no session field).
 */
export async function mintRealtimeClientSecret(input: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  expiresSeconds?: number;
  secretsPath?: string;
}): Promise<ClientSecretResult> {
  const apiKey = resolveVoiceApiKey(input.env ?? process.env, input.secretsPath);
  if (!apiKey) {
    return {
      ok: false,
      error: "No speech key is configured. Nothing was started.",
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
      }),
    });
  } catch {
    return { ok: false, error: "Voice secret service did not answer in time." };
  }
  if (!response.ok) {
    return { ok: false, error: formatClientSecretHttpError(response.status) };
  }
  let payload: { value?: string; expires_at?: number };
  try {
    payload = (await response.json()) as { value?: string; expires_at?: number };
  } catch {
    return { ok: false, error: "Voice secret service returned a response that could not be read." };
  }
  if (!payload.value) return { ok: false, error: "Voice secret service returned no token." };
  return { ok: true, value: payload.value, expiresAt: payload.expires_at ?? 0 };
}
