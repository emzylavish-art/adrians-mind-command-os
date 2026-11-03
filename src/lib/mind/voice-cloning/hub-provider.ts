/**
 * VoiceCloneProvider that talks ONLY to the Voice Connection Hub.
 */
import type { ProviderStatusReport } from "./types.ts";
import type { VoiceCloneProvider } from "./provider-interface.ts";
import { getStudioVoiceHub } from "./hub-client.ts";

export function createHubVoiceProvider(deps: {
  env?: Record<string, string | undefined>;
  providerId?: string;
  /** Injected hub for tests. */
  hub?: Awaited<ReturnType<typeof getStudioVoiceHub>>;
}): VoiceCloneProvider {
  const env = deps.env ?? process.env;
  const providerId = deps.providerId || env.VOICE_HUB_DEFAULT_PROVIDER || "chatterbox-local";

  async function hub() {
    return deps.hub ?? (await getStudioVoiceHub(env));
  }

  return {
    id: "local-http", // studio profile field; hub adapters are the real engines
    async status(): Promise<ProviderStatusReport> {
      try {
        const h = await (await hub()).health(providerId);
        const down = !h.ok;
        return {
          provider: "local-http",
          endpoint: `hub:${providerId}`,
          voiceKeyPresent: false,
          canList: !down,
          canClone: Boolean(h.ok),
          reason: h.detail || h.status,
          banner: down
            ? `Local voice engine not running (hub provider ${providerId}: ${h.detail || h.status}).`
            : `Voice hub provider ${providerId} is ready.`,
          probedAt: new Date().toISOString(),
          xaiOptionalEnabled: false,
          watermark: h.watermark ?? null,
          backend: h.backend ?? providerId,
        };
      } catch (err) {
        return {
          provider: "local-http",
          endpoint: "",
          voiceKeyPresent: false,
          canList: false,
          canClone: false,
          reason: err instanceof Error ? err.message : "hub down",
          banner: "Local voice engine not running (Voice Connection Hub is down).",
          probedAt: new Date().toISOString(),
          xaiOptionalEnabled: false,
          watermark: null,
          backend: null,
        };
      }
    },
    async createVoice(input) {
      try {
        const consentToken = (input as { consentToken?: string }).consentToken;
        const consentRecordId = (input as { consentRecordId?: string }).consentRecordId;
        if (!consentToken || !consentRecordId) {
          return {
            ok: false,
            code: "not_configured",
            error: "Hub create_voice requires a studio consent token and consent record id.",
          };
        }
        const result = await (await hub()).createVoice({
          providerId,
          name: input.name,
          profileId: input.profileId,
          consentToken,
          consentRecordId,
          fileBytes: input.fileBytes,
          filename: input.filename,
          mime: input.mime,
        });
        return { ok: true, voiceId: result.voiceId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "hub create failed";
        const code = /not running|down|not_ready|weights/i.test(msg) ? "not_configured" : "rejected";
        return { ok: false, code, error: msg };
      }
    },
    async deleteVoice(voiceId) {
      try {
        const result = await (await hub()).deleteVoice({ providerId, voiceId });
        return { ok: true, deleted: result.deleted };
      } catch {
        return { ok: true, deleted: false };
      }
    },
    async synthesize(input) {
      try {
        const result = await (await hub()).synthesize({
          providerId,
          voiceId: input.voiceId,
          text: input.text,
          format: input.format,
        });
        return { ok: true, bytes: result.bytes, mime: result.mime };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "hub synthesize failed",
          code: "network",
        };
      }
    },
  };
}
