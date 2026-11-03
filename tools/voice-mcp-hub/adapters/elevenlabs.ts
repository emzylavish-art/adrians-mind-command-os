import type { AdapterFactory } from "../adapter-interface.ts";

/** ElevenLabs REST — key from env only; never logged. Honest not-configured when missing. */
export const createAdapter: AdapterFactory = (env) => {
  const key = (env.ELEVENLABS_API_KEY || "").trim();
  const configured = Boolean(key);
  return {
    id: "elevenlabs",
    label: "ElevenLabs REST",
    disabled: !configured,
    async health() {
      if (!configured) {
        return {
          ok: false,
          status: "not_configured",
          detail: "ELEVENLABS_API_KEY is not set. ElevenLabs adapter is optional.",
          watermark: { enabled: false, name: null, note: "ElevenLabs watermark policy is vendor-side." },
          backend: "elevenlabs",
        };
      }
      try {
        const res = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(8_000),
        });
        return {
          ok: res.ok,
          status: res.ok ? "ok" : `http_${res.status}`,
          detail: res.ok ? "ElevenLabs API reachable." : `ElevenLabs user probe returned ${res.status}.`,
          watermark: { enabled: false, name: null, note: "Vendor-side; not PerTh." },
          backend: "elevenlabs",
        };
      } catch {
        return {
          ok: false,
          status: "down",
          detail: "ElevenLabs API did not answer.",
          watermark: null,
          backend: "elevenlabs",
        };
      }
    },
    async listVoices() {
      if (!configured) return [];
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`elevenlabs list ${res.status}`);
      const j = (await res.json()) as { voices?: Array<{ voice_id: string; name?: string }> };
      return (j.voices || []).map((v) => ({ voiceId: v.voice_id, name: v.name }));
    },
    async createVoice(input) {
      if (!configured) throw new Error("ElevenLabs not configured (missing ELEVENLABS_API_KEY).");
      const form = new FormData();
      form.append("name", input.name);
      form.append("files", new Blob([new Uint8Array(input.fileBytes)], { type: input.mime }), input.filename);
      const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": key },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`elevenlabs create ${res.status}`);
      const j = (await res.json()) as { voice_id?: string };
      if (!j.voice_id) throw new Error("elevenlabs create missing voice_id");
      return { voiceId: j.voice_id };
    },
    async synthesize(input) {
      if (!configured) throw new Error("ElevenLabs not configured (missing ELEVENLABS_API_KEY).");
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: input.text, model_id: env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`elevenlabs tts ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 2_000_000) throw new Error("elevenlabs tts too large");
      return { bytes, mime: "audio/mpeg" };
    },
    async deleteVoice(voiceId) {
      if (!configured) return { deleted: false };
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return { deleted: true };
      if (!res.ok) throw new Error(`elevenlabs delete ${res.status}`);
      return { deleted: true };
    },
  };
};

export default createAdapter;
