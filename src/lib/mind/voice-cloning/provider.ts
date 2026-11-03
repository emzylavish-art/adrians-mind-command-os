/**
 * xAI Custom Voices provider adapter.
 * Honest about Enterprise/team gating — never fakes a successful clone.
 * Reuses the same TTS endpoint as speakText (`https://api.x.ai/v1/tts`).
 */
import type { ProviderStatusReport } from "./types.ts";

export const XAI_CUSTOM_VOICES_URL = "https://api.x.ai/v1/custom-voices";
/** Same TTS URL used by src/lib/mind/server.ts speakText and speech.ts. */
export const XAI_TTS_URL = "https://api.x.ai/v1/tts";

export type CreateCustomVoiceResult =
  | { ok: true; voiceId: string }
  | { ok: false; code: "not_configured" | "rejected" | "network" | "invalid"; error: string };

export type DeleteCustomVoiceResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: string };

export type TtsResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; error: string; code?: string };

export type XaiCustomVoicesProvider = {
  id: "xai-custom-voices";
  status(): Promise<ProviderStatusReport>;
  createVoice(input: {
    name: string;
    language?: string;
    fileBytes: Uint8Array;
    filename: string;
    mime: string;
  }): Promise<CreateCustomVoiceResult>;
  deleteVoice(voiceId: string): Promise<DeleteCustomVoiceResult>;
  synthesize(input: { text: string; voiceId: string }): Promise<TtsResult>;
};

type FetchLike = typeof fetch;

function notConfiguredBanner(reason: string): string {
  return `Provider not configured: xAI Custom Voices API is unavailable (${reason}). Consent and profile storage still work; cloning and generate stay blocked until the team enables Custom Voices.`;
}

let cachedStatus: { at: number; report: ProviderStatusReport } | null = null;
const STATUS_TTL_MS = 60_000;

export function clearProviderStatusCache(): void {
  cachedStatus = null;
}

export function createXaiCustomVoicesProvider(deps: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  forceUnconfigured?: boolean;
  now?: () => number;
}): XaiCustomVoicesProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  async function status(): Promise<ProviderStatusReport> {
    const probedAt = new Date(now()).toISOString();
    if (deps.forceUnconfigured || process.env.VOICE_CLONING_FORCE_UNCONFIGURED === "1") {
      return {
        provider: "xai-custom-voices",
        voiceKeyPresent: Boolean(deps.apiKey),
        canList: false,
        canClone: false,
        reason: "Forced unconfigured (dev/e2e).",
        banner: notConfiguredBanner("forced"),
        probedAt,
      };
    }
    if (!deps.apiKey) {
      return {
        provider: "xai-custom-voices",
        voiceKeyPresent: false,
        canList: false,
        canClone: false,
        reason: "No XAI_VOICE_API_KEY configured. Chat key is not used for voice cloning.",
        banner: notConfiguredBanner("missing voice key"),
        probedAt,
      };
    }
    if (cachedStatus && now() - cachedStatus.at < STATUS_TTL_MS) {
      return cachedStatus.report;
    }

    let canList = false;
    let canClone = false;
    let reason = "Probe incomplete.";

    try {
      const list = await fetchImpl(XAI_CUSTOM_VOICES_URL, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${deps.apiKey}` },
      });
      canList = list.ok;
      if (!list.ok) {
        reason = `GET /v1/custom-voices returned ${list.status}.`;
      } else {
        const boundary = "----vcsprobe";
        const body =
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="name"\r\n\r\nvcs-capability-probe\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="probe.wav"\r\n` +
          `Content-Type: audio/wav\r\n\r\n` +
          `RIFF` +
          `\r\n--${boundary}--\r\n`;
        const create = await fetchImpl(XAI_CUSTOM_VOICES_URL, {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: {
            Authorization: `Bearer ${deps.apiKey}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
        if (create.status === 403) {
          let msg = "Custom voices are not enabled for this team.";
          try {
            const j = (await create.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* keep default */
          }
          reason = msg;
          canClone = false;
        } else if (create.status === 400 || create.status === 422) {
          canClone = true;
          reason = "Custom Voices API enabled for this team.";
        } else if (create.ok) {
          canClone = true;
          reason = "Custom Voices API enabled for this team.";
          try {
            const j = (await create.json()) as { voice_id?: string };
            if (j.voice_id) {
              await fetchImpl(`${XAI_CUSTOM_VOICES_URL}/${j.voice_id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${deps.apiKey}` },
              }).catch(() => undefined);
            }
          } catch {
            /* ignore */
          }
        } else {
          reason = `POST /v1/custom-voices returned ${create.status}.`;
          canClone = false;
        }
      }
    } catch {
      reason = "Custom Voices API did not answer in time.";
      canList = false;
      canClone = false;
    }

    const report: ProviderStatusReport = {
      provider: "xai-custom-voices",
      voiceKeyPresent: true,
      canList,
      canClone,
      reason,
      banner: canClone
        ? "xAI Custom Voices is configured. Authorized cloning is available."
        : notConfiguredBanner(reason),
      probedAt,
    };
    cachedStatus = { at: now(), report };
    return report;
  }

  return {
    id: "xai-custom-voices",
    status,
    async createVoice(input) {
      const st = await status();
      if (!st.canClone || !deps.apiKey) {
        return { ok: false, code: "not_configured", error: st.banner };
      }
      const form = new FormData();
      const copy = new Uint8Array(input.fileBytes);
      form.append("file", new Blob([copy], { type: input.mime }), input.filename);
      form.append("name", input.name.slice(0, 64));
      form.append("language", input.language || "en");
      let res: Response;
      try {
        res = await fetchImpl(XAI_CUSTOM_VOICES_URL, {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${deps.apiKey}` },
          body: form,
        });
      } catch {
        return { ok: false, code: "network", error: "Custom voice create did not answer in time." };
      }
      if (res.status === 403) {
        clearProviderStatusCache();
        return {
          ok: false,
          code: "not_configured",
          error: notConfiguredBanner("Custom voices are not enabled for this team."),
        };
      }
      if (!res.ok) {
        return { ok: false, code: "rejected", error: `Custom voice create returned ${res.status}.` };
      }
      let payload: { voice_id?: string };
      try {
        payload = (await res.json()) as { voice_id?: string };
      } catch {
        return { ok: false, code: "invalid", error: "Custom voice create returned unreadable JSON." };
      }
      if (!payload.voice_id || typeof payload.voice_id !== "string") {
        return { ok: false, code: "invalid", error: "Custom voice create returned no voice_id." };
      }
      return { ok: true, voiceId: payload.voice_id };
    },
    async deleteVoice(voiceId) {
      if (!deps.apiKey) return { ok: true, deleted: false };
      if (!voiceId || !/^[a-z0-9]{4,64}$/i.test(voiceId)) {
        return { ok: false, error: "Invalid provider voice id." };
      }
      try {
        const res = await fetchImpl(`${XAI_CUSTOM_VOICES_URL}/${encodeURIComponent(voiceId)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${deps.apiKey}` },
        });
        if (res.status === 404) return { ok: true, deleted: true };
        if (res.status === 403 || res.status === 401) return { ok: true, deleted: false };
        if (!res.ok) return { ok: false, error: `Provider delete returned ${res.status}.` };
        return { ok: true, deleted: true };
      } catch {
        return { ok: false, error: "Provider delete did not answer in time." };
      }
    },
    async synthesize(input) {
      if (!deps.apiKey) {
        return { ok: false, code: "not_configured", error: notConfiguredBanner("missing voice key") };
      }
      let res: Response;
      try {
        // Same request shape as speakText in server.ts — reuse existing TTS plumbing.
        res = await fetchImpl(XAI_TTS_URL, {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.apiKey}`,
          },
          body: JSON.stringify({
            text: input.text,
            voice_id: input.voiceId,
            language: "en",
            output_format: { codec: "mp3" },
          }),
        });
      } catch {
        return { ok: false, error: "Voice did not answer in time. Nothing was played." };
      }
      if (!res.ok) return { ok: false, error: `Voice returned ${res.status}. Nothing was played.` };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 32 || buf.length > 2_000_000) {
        return { ok: false, error: "Voice returned audio that could not be played." };
      }
      return { ok: true, bytes: buf, mime: "audio/mpeg" };
    },
  };
}
