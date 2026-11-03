/**
 * Default Voice Cloning Studio provider — local HTTP engine on Zack's PC.
 * Contract: docs/voice-cloning/local-endpoint.md
 */
import type { ProviderStatusReport } from "./types.ts";
import type {
  CreateCustomVoiceResult,
  DeleteCustomVoiceResult,
  TtsResult,
  VoiceCloneProvider,
} from "./provider-interface.ts";
import {
  DEFAULT_VOICE_CLONE_LOCAL_URL,
  resolveVoiceCloneLocalUrl,
  voiceCloneAllowRemoteFromEnv,
} from "./local-url.ts";

export const LOCAL_MAX_TTS_BYTES = 2_000_000;
export const LOCAL_HEALTH_TIMEOUT_MS = 3_000;
export const LOCAL_TTS_TIMEOUT_MS = 30_000;
export const LOCAL_CREATE_TIMEOUT_MS = 60_000;

type FetchLike = typeof fetch;

function notRunningBanner(base: string, detail: string): string {
  return `Local voice engine not running at ${base}. ${detail} Start tools/voice-clone-server on your PC (or your cloning backend) and try again.`;
}

export function createLocalHttpVoiceProvider(deps: {
  baseUrl?: string;
  allowRemote?: boolean;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Test/dev: skip live probe and report not running. */
  forceDown?: boolean;
}): VoiceCloneProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  function resolveBase(): { ok: true; base: string } | { ok: false; error: string } {
    return resolveVoiceCloneLocalUrl(deps.baseUrl ?? process.env.VOICE_CLONE_LOCAL_URL, {
      allowRemote: deps.allowRemote ?? voiceCloneAllowRemoteFromEnv(process.env),
      fallback: DEFAULT_VOICE_CLONE_LOCAL_URL,
    });
  }

  async function status(): Promise<ProviderStatusReport> {
    const probedAt = new Date(now()).toISOString();
    const resolved = resolveBase();
    if (!resolved.ok) {
      return {
        provider: "local-http",
        endpoint: "",
        voiceKeyPresent: false,
        canList: false,
        canClone: false,
        reason: resolved.error,
        banner: resolved.error,
        probedAt,
        xaiOptionalEnabled: false,
        watermark: null,
        backend: null,
      };
    }
    const base = resolved.base;
    if (deps.forceDown || process.env.VOICE_CLONE_FORCE_DOWN === "1") {
      return {
        provider: "local-http",
        endpoint: base,
        voiceKeyPresent: false,
        canList: false,
        canClone: false,
        reason: "Forced down (dev/e2e).",
        banner: notRunningBanner(base, "Forced offline for tests."),
        probedAt,
        xaiOptionalEnabled: false,
        watermark: null,
        backend: null,
      };
    }
    try {
      const res = await fetchImpl(`${base}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(LOCAL_HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) {
        return {
          provider: "local-http",
          endpoint: base,
          voiceKeyPresent: false,
          canList: false,
          canClone: false,
          reason: `GET /health returned ${res.status}.`,
          banner: notRunningBanner(base, `Health check returned ${res.status}.`),
          probedAt,
          xaiOptionalEnabled: false,
          watermark: null,
          backend: null,
        };
      }
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if (!ctype.includes("application/json")) {
        return {
          provider: "local-http",
          endpoint: base,
          voiceKeyPresent: false,
          canList: false,
          canClone: false,
          reason: "Health response was not JSON.",
          banner: notRunningBanner(base, "Health response had the wrong content type."),
          probedAt,
          xaiOptionalEnabled: false,
          watermark: null,
          backend: null,
        };
      }
      let body: {
        ok?: boolean;
        status?: string;
        backend?: string;
        watermark?: { enabled?: boolean; name?: string | null; note?: string };
        load_error?: string;
      } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return {
          provider: "local-http",
          endpoint: base,
          voiceKeyPresent: false,
          canList: false,
          canClone: false,
          reason: "Health JSON was unreadable.",
          banner: notRunningBanner(base, "Health JSON was unreadable."),
          probedAt,
          xaiOptionalEnabled: false,
          watermark: null,
          backend: null,
        };
      }
      const watermark = body.watermark
        ? {
            enabled: Boolean(body.watermark.enabled),
            name: body.watermark.name ?? null,
            note: body.watermark.note || "",
          }
        : null;
      const backend = typeof body.backend === "string" ? body.backend : null;
      const healthy = body.ok === true || body.status === "ok" || body.status === "ready";
      if (!healthy) {
        const detail = body.load_error || "Engine reported not ready (weights may still need to be installed on your PC).";
        return {
          provider: "local-http",
          endpoint: base,
          voiceKeyPresent: false,
          canList: false,
          canClone: false,
          reason: detail,
          banner: notRunningBanner(base, detail),
          probedAt,
          xaiOptionalEnabled: false,
          watermark,
          backend,
        };
      }
      return {
        provider: "local-http",
        endpoint: base,
        voiceKeyPresent: false,
        canList: true,
        canClone: true,
        reason: "Local voice engine is healthy.",
        banner: `Local voice engine is running at ${base}. Authorized cloning is available.`,
        probedAt,
        xaiOptionalEnabled: false,
        watermark,
        backend,
      };
    } catch {
      return {
        provider: "local-http",
        endpoint: base,
        voiceKeyPresent: false,
        canList: false,
        canClone: false,
        reason: "Health check did not answer.",
        banner: notRunningBanner(base, "Nothing answered on /health."),
        probedAt,
        xaiOptionalEnabled: false,
        watermark: null,
        backend: null,
      };
    }
  }

  return {
    id: "local-http",
    status,
    async createVoice(input) {
      const st = await status();
      if (!st.canClone) {
        return { ok: false, code: "not_configured", error: st.banner };
      }
      const base = st.endpoint;
      const form = new FormData();
      const copy = new Uint8Array(input.fileBytes);
      form.append("file", new Blob([copy], { type: input.mime }), input.filename);
      form.append("name", input.name.slice(0, 64));
      if (input.profileId) form.append("profile_id", input.profileId);
      form.append("language", input.language || "en");
      let res: Response;
      try {
        res = await fetchImpl(`${base}/voices`, {
          method: "POST",
          signal: AbortSignal.timeout(LOCAL_CREATE_TIMEOUT_MS),
          body: form,
        });
      } catch {
        return { ok: false, code: "network", error: notRunningBanner(base, "POST /voices timed out.") };
      }
      if (!res.ok) {
        return { ok: false, code: "rejected", error: `Local engine create returned ${res.status}.` };
      }
      let payload: { voice_id?: string; id?: string };
      try {
        payload = (await res.json()) as { voice_id?: string; id?: string };
      } catch {
        return { ok: false, code: "invalid", error: "Local engine create returned unreadable JSON." };
      }
      const voiceId = payload.voice_id || payload.id;
      if (!voiceId || typeof voiceId !== "string") {
        return { ok: false, code: "invalid", error: "Local engine create returned no voice_id." };
      }
      return { ok: true, voiceId };
    },
    async deleteVoice(voiceId) {
      const resolved = resolveBase();
      if (!resolved.ok) return { ok: true, deleted: false };
      if (!voiceId || !/^[a-zA-Z0-9_\-]{2,128}$/.test(voiceId)) {
        return { ok: false, error: "Invalid provider voice id." };
      }
      try {
        const res = await fetchImpl(`${resolved.base}/voices/${encodeURIComponent(voiceId)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(LOCAL_HEALTH_TIMEOUT_MS * 2),
        });
        if (res.status === 404) return { ok: true, deleted: true };
        if (!res.ok) return { ok: false, error: `Local engine delete returned ${res.status}.` };
        return { ok: true, deleted: true };
      } catch {
        // Engine down after local delete is still OK — studio store is source of truth for UX.
        return { ok: true, deleted: false };
      }
    },
    async synthesize(input) {
      const st = await status();
      if (!st.canClone) {
        return { ok: false, code: "not_configured", error: st.banner };
      }
      const base = st.endpoint;
      const format = input.format || "wav";
      let res: Response;
      try {
        res = await fetchImpl(`${base}/tts`, {
          method: "POST",
          signal: AbortSignal.timeout(LOCAL_TTS_TIMEOUT_MS),
          headers: { "Content-Type": "application/json", Accept: format === "mp3" ? "audio/mpeg" : "audio/wav" },
          body: JSON.stringify({
            voice_id: input.voiceId,
            text: input.text,
            format,
          }),
        });
      } catch {
        return { ok: false, error: notRunningBanner(base, "POST /tts timed out."), code: "network" };
      }
      if (!res.ok) {
        return { ok: false, error: `Local engine TTS returned ${res.status}.` };
      }
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if (!(ctype.includes("audio/") || ctype.includes("octet-stream"))) {
        return { ok: false, error: "Local engine TTS returned a non-audio content type.", code: "bad_content_type" };
      }
      const cl = Number(res.headers.get("content-length") || 0);
      if (cl > LOCAL_MAX_TTS_BYTES) {
        return { ok: false, error: "Local engine TTS response is too large.", code: "too_large" };
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 32) {
        return { ok: false, error: "Local engine returned audio that could not be played." };
      }
      if (buf.length > LOCAL_MAX_TTS_BYTES) {
        return { ok: false, error: "Local engine TTS response is too large.", code: "too_large" };
      }
      const mime = ctype.includes("mpeg") || ctype.includes("mp3") ? "audio/mpeg" : ctype.includes("wav") ? "audio/wav" : format === "mp3" ? "audio/mpeg" : "audio/wav";
      return { ok: true, bytes: buf, mime };
    },
  };
}
