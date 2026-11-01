/** Server-side helpers for xAI realtime ephemeral client secrets. Docs: POST /v1/realtime/client_secrets with XAI_API_KEY. */

export type ClientSecretResult =
  | { ok: true; value: string; expiresAt: number }
  | { ok: false; error: string };

export function realtimeWsUrl(model = "grok-voice-latest"): string {
  return `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`;
}

export function browserWsProtocols(ephemeralValue: string): string[] {
  return [`xai-client-secret.${ephemeralValue}`];
}

export async function mintRealtimeClientSecret(input: {
  apiKey: string | undefined;
  fetch: typeof fetch;
  expiresSeconds?: number;
}): Promise<ClientSecretResult> {
  if (!input.apiKey) {
    return {
      ok: false,
      error: "No XAI_API_KEY is configured on the server. An ephemeral realtime client secret was not minted. Live voice is not connected.",
    };
  }
  try {
    const response = await input.fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expires_after: { seconds: input.expiresSeconds ?? 300 } }),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `The realtime client-secret endpoint returned ${response.status}. Live voice is not connected. Nothing was invented.`,
      };
    }
    const payload = (await response.json()) as { value?: string; expires_at?: number };
    if (!payload.value) {
      return { ok: false, error: "The realtime client-secret response had no value. Live voice is not connected." };
    }
    return { ok: true, value: payload.value, expiresAt: payload.expires_at ?? 0 };
  } catch {
    return { ok: false, error: "The realtime client-secret endpoint could not be reached. Live voice is not connected." };
  }
}

export async function transcribeWithXai(input: {
  apiKey: string | undefined;
  fetch: typeof fetch;
  bytes: ArrayBuffer;
  filename?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!input.apiKey) {
    return {
      ok: false,
      error: "No XAI_API_KEY is configured on the server. Provider STT was not called. Use browser speech recognition as a labeled fallback.",
    };
  }
  try {
    const form = new FormData();
    form.append("model", "grok-voice-transcribe-2.0");
    form.append("file", new Blob([input.bytes]), input.filename ?? "note.webm");
    const response = await input.fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      return { ok: false, error: `Provider STT returned ${response.status}. Nothing was transcribed.` };
    }
    const payload = (await response.json()) as { text?: string };
    const text = (payload.text ?? "").trim();
    if (!text) return { ok: false, error: "Provider STT returned no text. Nothing was put in the composer." };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "Provider STT could not be reached. Nothing was transcribed." };
  }
}
