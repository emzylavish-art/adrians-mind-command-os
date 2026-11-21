import type { AdapterFactory, VoiceProviderAdapter } from "../adapter-interface.ts";

const voices = new Map<string, { name: string }>();

function toneWav(seed: number): Uint8Array {
  const n = 512;
  const buf = new Uint8Array(44 + n);
  const view = new DataView(buf.buffer);
  buf.set([82, 73, 70, 70], 0); // RIFF
  view.setUint32(4, 36 + n, true);
  buf.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  buf.set([100, 97, 116, 97], 36);
  view.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = (seed + i) & 0xff;
  return buf;
}

export const createAdapter: AdapterFactory = (): VoiceProviderAdapter => ({
  id: "mock",
  label: "Mock tone (tests)",
  async health() {
    return {
      ok: true,
      status: "ok",
      backend: "mock",
      watermark: { enabled: false, name: null, note: "Mock has no PerTh watermark." },
      detail: "mock-verified — not a real clone",
    };
  },
  async listVoices() {
    return [...voices.entries()].map(([voiceId, v]) => ({ voiceId, name: v.name }));
  },
  async createVoice(input) {
    const id = `mock_${voices.size + 1}`;
    voices.set(id, { name: input.name });
    return { voiceId: id };
  },
  async synthesize(input) {
    if (!voices.has(input.voiceId)) throw new Error("voice not found");
    let seed = 0;
    for (let i = 0; i < input.text.length; i++) seed = (seed + input.text.charCodeAt(i)) | 0;
    return { bytes: toneWav(seed), mime: "audio/wav" };
  },
  async deleteVoice(voiceId) {
    return { deleted: voices.delete(voiceId) };
  },
});

export default createAdapter;
