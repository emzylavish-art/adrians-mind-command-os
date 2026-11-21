import type { AdapterFactory } from "../adapter-interface.ts";
import { httpHealth, resolveBase } from "./_http.ts";

export const createAdapter: AdapterFactory = (env) => {
  const base = resolveBase(env, "VOICE_CHATTERBOX_URL", "http://127.0.0.1:7860");
  const fetchImpl = fetch;
  return {
    id: "chatterbox-local",
    label: "Chatterbox local (default)",
    async health() {
      const h = await httpHealth(base, fetchImpl);
      return {
        ...h,
        backend: h.backend || "chatterbox",
        watermark: h.watermark ?? {
          enabled: h.ok,
          name: h.ok ? "PerTh" : null,
          note: h.ok
            ? "Chatterbox embeds PerTh when the local weights are loaded."
            : "Watermark is unknown until the local engine answers.",
        },
      };
    },
    async listVoices() {
      return [];
    },
    async createVoice(input) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(input.fileBytes)], { type: input.mime }), input.filename);
      form.append("name", input.name);
      if (input.profileId) form.append("profile_id", input.profileId);
      const res = await fetchImpl(`${base}/voices`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`chatterbox create ${res.status}`);
      const j = (await res.json()) as { voice_id?: string; id?: string };
      const voiceId = j.voice_id || j.id;
      if (!voiceId) throw new Error("chatterbox create missing voice_id");
      return { voiceId };
    },
    async synthesize(input) {
      const res = await fetchImpl(`${base}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_id: input.voiceId, text: input.text, format: input.format || "wav" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`chatterbox tts ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") || "audio/wav").split(";")[0]!;
      return { bytes, mime };
    },
    async deleteVoice(voiceId) {
      const res = await fetchImpl(`${base}/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) return { deleted: true };
      if (!res.ok) throw new Error(`chatterbox delete ${res.status}`);
      return { deleted: true };
    },
  };
};

export default createAdapter;
