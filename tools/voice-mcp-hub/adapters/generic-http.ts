import type { AdapterFactory } from "../adapter-interface.ts";
import { httpHealth, resolveBase } from "./_http.ts";

/** Any local engine that implements docs/voice-cloning/local-endpoint.md */
export const createAdapter: AdapterFactory = (env) => {
  const base = resolveBase(env, "VOICE_GENERIC_HTTP_URL", "http://127.0.0.1:7860");
  return {
    id: "generic-http",
    label: "Generic local HTTP contract",
    async health() {
      return httpHealth(base);
    },
    async listVoices() {
      return [];
    },
    async createVoice(input) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(input.fileBytes)], { type: input.mime }), input.filename);
      form.append("name", input.name);
      if (input.profileId) form.append("profile_id", input.profileId);
      const res = await fetch(`${base}/voices`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`generic-http create ${res.status}`);
      const j = (await res.json()) as { voice_id?: string; id?: string };
      const voiceId = j.voice_id || j.id;
      if (!voiceId) throw new Error("generic-http missing voice_id");
      return { voiceId };
    },
    async synthesize(input) {
      const res = await fetch(`${base}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_id: input.voiceId, text: input.text, format: input.format || "wav" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`generic-http tts ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 2_000_000) throw new Error("generic-http tts too large");
      return { bytes, mime: (res.headers.get("content-type") || "audio/wav").split(";")[0]! };
    },
    async deleteVoice(voiceId) {
      const res = await fetch(`${base}/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return { deleted: true };
      if (!res.ok) throw new Error(`generic-http delete ${res.status}`);
      return { deleted: true };
    },
  };
};

export default createAdapter;
