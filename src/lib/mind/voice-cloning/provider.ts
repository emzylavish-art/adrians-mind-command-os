/**
 * Provider registry for Voice Cloning Studio.
 * Default: local-http (Zack's PC). xAI Custom Voices is optional and disabled by default
 * (xAI does not provide cloning for this team / product path).
 */
import type { ProviderStatusReport } from "./types.ts";
import type { VoiceCloneProvider } from "./provider-interface.ts";
import { createLocalHttpVoiceProvider } from "./local-provider.ts";
import { createHubVoiceProvider } from "./hub-provider.ts";
import { resolveVoiceApiKey } from "../voice/keys.ts";

export type {
  CreateCustomVoiceResult,
  DeleteCustomVoiceResult,
  TtsResult,
  VoiceCloneProvider,
} from "./provider-interface.ts";

export const XAI_CUSTOM_VOICES_URL = "https://api.x.ai/v1/custom-voices";
export const XAI_TTS_URL = "https://api.x.ai/v1/tts";

type FetchLike = typeof fetch;

function xaiDisabledBanner(): string {
  return "xAI Custom Voices is optional and disabled by default. Adrian's Mind uses the local voice engine on your PC. Set VOICE_CLONE_PROVIDER=xai only if you intentionally enable that path.";
}

/** Optional xAI adapter — only used when VOICE_CLONE_PROVIDER=xai. */
export function createXaiCustomVoicesProvider(deps: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  forceUnconfigured?: boolean;
  now?: () => number;
  /** When false (default), status reports disabled even if a key exists. */
  enabled?: boolean;
}): VoiceCloneProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const enabled = deps.enabled === true;

  async function status(): Promise<ProviderStatusReport> {
    const probedAt = new Date(now()).toISOString();
    if (!enabled) {
      return {
        provider: "xai-custom-voices",
        endpoint: "",
        voiceKeyPresent: Boolean(deps.apiKey),
        canList: false,
        canClone: false,
        reason: "xAI provider disabled (default).",
        banner: xaiDisabledBanner(),
        probedAt,
        xaiOptionalEnabled: false,
        watermark: null,
        backend: null,
      };
    }
    if (deps.forceUnconfigured || process.env.VOICE_CLONING_FORCE_UNCONFIGURED === "1") {
      return {
        provider: "xai-custom-voices",
        endpoint: "",
        voiceKeyPresent: Boolean(deps.apiKey),
        canList: false,
        canClone: false,
        reason: "Forced unconfigured (dev/e2e).",
        banner: "Provider not configured: xAI Custom Voices forced off.",
        probedAt,
        xaiOptionalEnabled: true,
        watermark: null,
        backend: null,
      };
    }
    if (!deps.apiKey) {
      return {
        provider: "xai-custom-voices",
        endpoint: "",
        voiceKeyPresent: false,
        canList: false,
        canClone: false,
        reason: "No XAI_VOICE_API_KEY.",
        banner: "Provider not configured: missing voice key for optional xAI path.",
        probedAt,
        xaiOptionalEnabled: true,
        watermark: null,
        backend: null,
      };
    }
    // Lightweight probe — never assume cloning works.
    try {
      const list = await fetchImpl(XAI_CUSTOM_VOICES_URL, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${deps.apiKey}` },
      });
      if (!list.ok) {
        return {
          provider: "xai-custom-voices",
          endpoint: XAI_CUSTOM_VOICES_URL,
          voiceKeyPresent: true,
          canList: false,
          canClone: false,
          reason: `GET /v1/custom-voices returned ${list.status}.`,
          banner: `Provider not configured: xAI list returned ${list.status}.`,
          probedAt,
          xaiOptionalEnabled: true,
          watermark: null,
          backend: null,
        };
      }
      return {
        provider: "xai-custom-voices",
        endpoint: XAI_CUSTOM_VOICES_URL,
        voiceKeyPresent: true,
        canList: true,
        canClone: false,
        reason: "xAI list OK but product default is local cloning; treat xAI as non-cloning.",
        banner: "Optional xAI path is listed but Adrian's Mind cloning uses the local engine. Prefer VOICE_CLONE_PROVIDER=local.",
        probedAt,
        xaiOptionalEnabled: true,
        watermark: null,
        backend: null,
      };
    } catch {
      return {
        provider: "xai-custom-voices",
        endpoint: "",
        voiceKeyPresent: true,
        canList: false,
        canClone: false,
        reason: "xAI Custom Voices did not answer.",
        banner: "Provider not configured: xAI Custom Voices did not answer.",
        probedAt,
        xaiOptionalEnabled: true,
        watermark: null,
        backend: null,
      };
    }
  }

  return {
    id: "xai-custom-voices",
    status,
    async createVoice() {
      const st = await status();
      return { ok: false, code: "not_configured", error: st.banner };
    },
    async deleteVoice() {
      return { ok: true, deleted: false };
    },
    async synthesize() {
      const st = await status();
      return { ok: false, error: st.banner, code: "not_configured" };
    },
  };
}

export function clearProviderStatusCache(): void {
  /* local provider is uncached per-call; kept for API compatibility */
}

export type ResolveProviderOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  /** Injected provider for tests. */
  override?: VoiceCloneProvider;
  localBaseUrl?: string;
  apiKey?: string | undefined;
};

/**
 * Pick the active provider.
 * Default: local-http. Set VOICE_CLONE_PROVIDER=xai to opt into the disabled-by-default xAI path.
 */
export function resolveVoiceCloneProvider(options: ResolveProviderOptions = {}): VoiceCloneProvider {
  if (options.override) return options.override;
  const env = options.env ?? process.env;
  const which = (env.VOICE_CLONE_PROVIDER || "hub").trim().toLowerCase();
  if (which === "xai" || which === "xai-custom-voices") {
    const apiKey = options.apiKey !== undefined ? options.apiKey : resolveVoiceApiKey(env);
    return createXaiCustomVoicesProvider({
      apiKey,
      fetchImpl: options.fetchImpl,
      enabled: true,
    });
  }
  // Direct local HTTP bypass (debug only). Default is hub.
  if (which === "local" || which === "local-http" || which === "direct-local") {
    return createLocalHttpVoiceProvider({
      baseUrl: options.localBaseUrl ?? env.VOICE_CLONE_LOCAL_URL,
      fetchImpl: options.fetchImpl,
    });
  }
  return createHubVoiceProvider({
    env,
    providerId: env.VOICE_HUB_DEFAULT_PROVIDER || "chatterbox-local",
  });
}
