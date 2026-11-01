import { resolveVoiceApiKey } from "./keys.ts";

export const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

export type ClientSecretResult =
  | { ok: true; value: string; expiresAt: number }
  | { ok: false; error: string };

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
      }),
    });
  } catch {
    return { ok: false, error: "Voice secret service did not answer in time." };
  }
  if (!response.ok) {
    return { ok: false, error: `Voice secret service returned ${response.status}.` };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: "Voice secret service returned a response that could not be read." };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Voice secret service returned a response that could not be read." };
  }
  const record = payload as { value?: unknown; expires_at?: unknown };
  if (typeof record.value !== "string" || !record.value.trim()) {
    return { ok: false, error: "Voice secret service returned no token." };
  }
  if (typeof record.expires_at !== "number" || !Number.isFinite(record.expires_at)) {
    return { ok: false, error: "Voice secret service returned no expiry." };
  }
  return { ok: true, value: record.value, expiresAt: record.expires_at };
}
