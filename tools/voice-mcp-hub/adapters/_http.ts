/** Shared local HTTP helpers for chatterbox/cosyvoice/generic adapters. */
export async function httpHealth(base: string, fetchImpl: typeof fetch = fetch) {
  try {
    const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false as const, status: `http_${res.status}`, detail: `GET /health ${res.status}` };
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("application/json")) {
      return { ok: false as const, status: "bad_content_type", detail: "Health was not JSON" };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      status?: string;
      backend?: string;
      watermark?: { enabled?: boolean; name?: string | null; note?: string };
      load_error?: string;
    };
    const healthy = body.ok === true || body.status === "ok" || body.status === "ready";
    return {
      ok: healthy,
      status: healthy ? "ok" : body.status || "not_ready",
      detail: body.load_error || undefined,
      backend: body.backend || null,
      watermark: body.watermark
        ? {
            enabled: Boolean(body.watermark.enabled),
            name: body.watermark.name ?? null,
            note: body.watermark.note || "",
          }
        : null,
    };
  } catch (err) {
    return {
      ok: false as const,
      status: "down",
      detail: err instanceof Error ? err.message : "health failed",
      backend: null,
      watermark: null,
    };
  }
}

export function resolveBase(env: Record<string, string | undefined>, key: string, fallback: string): string {
  return (env[key] || env.VOICE_CLONE_LOCAL_URL || fallback).replace(/\/$/, "");
}
