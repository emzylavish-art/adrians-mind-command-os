/**
 * Voice Connection Hub runtime — sole engine facade for Adrian's Mind Studio.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoiceProviderAdapter } from "../adapter-interface.ts";
import { assertSafeAdapterId, loadAdaptersFromDir } from "./discover.ts";
import { loadRegistry } from "./registry.ts";
import { verifyConsentToken } from "./consent-token.ts";

const MAX_SYNTH_BYTES = 2_000_000;

export type VoiceHub = {
  listProviders(): Promise<Array<{ id: string; label: string; disabled?: boolean; health: Awaited<ReturnType<VoiceProviderAdapter["health"]>> }>>;
  health(providerId?: string): Promise<Awaited<ReturnType<VoiceProviderAdapter["health"]>> & { providerId: string; hub: "ok" | "degraded" }>;
  createVoice(input: {
    providerId?: string;
    name: string;
    profileId?: string;
    consentToken: string;
    consentRecordId: string;
    fileBytes: Uint8Array;
    filename: string;
    mime: string;
  }): Promise<{ voiceId: string; providerId: string }>;
  synthesize(input: {
    providerId?: string;
    voiceId: string;
    text: string;
    format?: "wav" | "mp3";
  }): Promise<{ bytes: Uint8Array; mime: string; providerId: string }>;
  deleteVoice(input: { providerId?: string; voiceId: string }): Promise<{ deleted: boolean; providerId: string }>;
  listVoices(providerId?: string): Promise<Array<{ voiceId: string; name?: string; providerId: string }>>;
};

function hubRootFromImportMeta(): string {
  try {
    return join(fileURLToPath(new URL("..", import.meta.url)));
  } catch {
    return join(process.cwd(), "tools/voice-mcp-hub");
  }
}

export async function createVoiceHub(options: {
  env?: Record<string, string | undefined>;
  adaptersDir?: string;
  hubRoot?: string;
  /** Injected clock so Studio tests can issue + verify consent tokens with a fixed now. */
  now?: () => number;
} = {}): Promise<VoiceHub> {
  const env = options.env ?? process.env;
  const root = options.hubRoot ?? hubRootFromImportMeta();
  const adaptersDir = options.adaptersDir ?? join(root, "adapters");
  const registry = loadRegistry(env, root);
  const all = await loadAdaptersFromDir(adaptersDir, env);
  const adapters = new Map<string, VoiceProviderAdapter>();
  for (const id of registry.enabled) {
    const a = all.get(id);
    if (a) adapters.set(id, a);
  }
  // Always ensure mock available for tests if present on disk
  if (all.has("mock") && !adapters.has("mock")) adapters.set("mock", all.get("mock")!);
  const now = options.now ?? Date.now;

  function resolveProvider(providerId?: string): VoiceProviderAdapter {
    const id = (providerId || registry.defaultProvider).trim();
    assertSafeAdapterId(id);
    const a = adapters.get(id);
    if (!a) throw new Error(`Unknown or disabled provider ${id}.`);
    return a;
  }

  return {
    async listProviders() {
      const rows = [];
      for (const [id, a] of adapters) {
        let health;
        try {
          health = await a.health();
        } catch (err) {
          health = {
            ok: false,
            status: "adapter_throw",
            detail: err instanceof Error ? err.message : "health threw",
            watermark: null,
            backend: id,
          };
        }
        rows.push({ id, label: a.label, disabled: a.disabled, health });
      }
      return rows;
    },

    async health(providerId) {
      try {
        const a = resolveProvider(providerId);
        const h = await a.health();
        return { ...h, providerId: a.id, hub: h.ok ? "ok" : "degraded" };
      } catch (err) {
        return {
          ok: false,
          status: "hub_error",
          detail: err instanceof Error ? err.message : "hub health failed",
          watermark: null,
          backend: null,
          providerId: providerId || registry.defaultProvider,
          hub: "degraded",
        };
      }
    },

    async createVoice(input) {
      const verified = verifyConsentToken(input.consentToken, input.consentRecordId, env, now());
      if (!verified.ok) throw new Error(verified.error);
      const a = resolveProvider(input.providerId);
      if (a.disabled) throw new Error(`Provider ${a.id} is disabled.`);
      const result = await a.createVoice({
        name: input.name,
        profileId: input.profileId,
        consentToken: input.consentToken,
        consentRecordId: input.consentRecordId,
        fileBytes: input.fileBytes,
        filename: input.filename,
        mime: input.mime,
      });
      return { voiceId: result.voiceId, providerId: a.id };
    },

    async synthesize(input) {
      if (!input.text || input.text.length > 500) throw new Error("Text missing or too long.");
      const a = resolveProvider(input.providerId);
      if (a.disabled) throw new Error(`Provider ${a.id} is disabled.`);
      const result = await a.synthesize({
        voiceId: input.voiceId,
        text: input.text,
        format: input.format || "wav",
      });
      if (result.bytes.length > MAX_SYNTH_BYTES) throw new Error("Synthesize response too large.");
      if (result.bytes.length < 32) throw new Error("Synthesize returned empty audio.");
      return { ...result, providerId: a.id };
    },

    async deleteVoice(input) {
      const a = resolveProvider(input.providerId);
      const result = await a.deleteVoice(input.voiceId);
      return { deleted: result.deleted, providerId: a.id };
    },

    async listVoices(providerId) {
      const a = resolveProvider(providerId);
      const voices = await a.listVoices();
      return voices.map((v) => ({ ...v, providerId: a.id }));
    },
  };
}
