import type { AdapterFactory } from "../adapter-interface.ts";

/** Documented as unsupported for cloning — always disabled. */
export const createAdapter: AdapterFactory = () => ({
  id: "xai",
  label: "xAI Custom Voices (unsupported for cloning)",
  disabled: true,
  async health() {
    return {
      ok: false,
      status: "unsupported",
      detail:
        "xAI does not provide voice cloning for Adrian's Mind. Use chatterbox-local (default) or another adapter.",
      watermark: null,
      backend: "xai",
    };
  },
  async listVoices() {
    return [];
  },
  async createVoice() {
    throw new Error("xAI adapter is disabled — unsupported for cloning.");
  },
  async synthesize() {
    throw new Error("xAI adapter is disabled — unsupported for cloning.");
  },
  async deleteVoice() {
    return { deleted: false };
  },
});

export default createAdapter;
