/** Map thrown / returned voice failures to always-visible user text. Never silent. */

import type { VoiceRoutingMode } from "./mode.ts";

export const VOICE_SIGN_IN_REQUIRED =
  "Sign in is required before using Speak.";

export const VOICE_START_FAILED = "Voice capture could not start.";

export const VOICE_MIC_DENIED =
  "Microphone permission was denied. Allow the mic for this site, then try Start voice again.";

export const VOICE_MIC_MISSING =
  "No microphone was found. Connect a mic, then try Start voice again.";

export const VOICE_CONNECTION_DROPPED =
  "Voice connection dropped. The mic was released. Press Start voice to try again.";

export function formatVoiceClientError(err: unknown): string {
  if (err && typeof err === "object" && "ok" in err && (err as { ok?: boolean }).ok === false) {
    const message = String((err as { error?: string }).error ?? "").trim();
    if (message === "Unauthorized") return VOICE_SIGN_IN_REQUIRED;
    if (message) return message;
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const trimmed = message.trim();
  if (!trimmed) return VOICE_START_FAILED;
  if (trimmed === "Unauthorized" || /^unauthorized\b/i.test(trimmed)) return VOICE_SIGN_IN_REQUIRED;
  const mic = formatMicCaptureError(err);
  if (mic) return mic;
  return trimmed;
}

export function formatMicCaptureError(err: unknown): string | null {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (name === "NotAllowedError" || /permission|not allowed|denied/i.test(message)) return VOICE_MIC_DENIED;
  if (name === "NotFoundError" || /not found|no device|Requested device not found/i.test(message)) return VOICE_MIC_MISSING;
  return null;
}

export const DIRECT_FALLBACK_NOTICE = "Orchestrator is unavailable. Your voice preference is unchanged. Connect the selected Ollama runtime or explicitly choose Direct.";

/** Voice starts on the server xAI path unless a paired computer is actually available. */
export function defaultVoiceMode(): VoiceRoutingMode {
  return "direct";
}

/**
 * Runtime availability never rewrites the saved mode or authorizes another provider.
 * A blocked route must stop before minting a cloud session.
 */
export function resolveVoiceMode(
  mode: VoiceRoutingMode | null | undefined,
  pairedComputer: boolean,
): { mode: VoiceRoutingMode; fellBack: boolean; blocked: boolean; notice: string | null } {
  const selected: VoiceRoutingMode = mode === "orchestrator" ? "orchestrator" : "direct";
  if (selected === "orchestrator" && !pairedComputer) {
    return { mode: "orchestrator", fellBack: false, blocked: true, notice: DIRECT_FALLBACK_NOTICE };
  }
  return { mode: selected, fellBack: false, blocked: false, notice: null };
}

/**
 * Hydrate a stored choice independently of temporary runtime availability.
 */
export function hydrateResolvedVoiceMode(raw: string | null | undefined, pairedComputer: boolean): VoiceRoutingMode {
  return resolveVoiceMode(raw === "orchestrator" ? "orchestrator" : "direct", pairedComputer).mode;
}

/**
 * Persist only after client hydrate.
 * Availability is checked when starting; it does not revoke a user preference.
 */
export function shouldPersistVoiceMode(hydrated: boolean, mode?: VoiceRoutingMode, pairedComputer?: boolean): boolean {
  if (!hydrated) return false;
  void mode;
  void pairedComputer;
  return true;
}

/** Mode choice, then the session mint, then connect. Providers are injected so tests make no network calls. */
export async function beginVoiceModeSession(input: {
  mode: VoiceRoutingMode;
  pairedComputer: boolean;
  mint: () => Promise<{ ok: boolean; value?: string; error?: string }>;
  connect: (secret: string) => Promise<void>;
}): Promise<{ mode: VoiceRoutingMode; notice: string | null; error: string | null; connected: boolean }> {
  const route = resolveVoiceMode(input.mode, input.pairedComputer);
  if (route.blocked) return { mode: route.mode, notice: route.notice, error: route.notice, connected: false };
  const secret = await input.mint();
  if (!secret.ok || !secret.value) {
    return {
      mode: route.mode,
      notice: route.notice,
      error: secret.error ?? "Voice capture could not start.",
      connected: false,
    };
  }
  await input.connect(secret.value);
  return { mode: route.mode, notice: route.notice, error: null, connected: true };
}
