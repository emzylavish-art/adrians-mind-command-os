import type { VoiceRoutingMode } from "./mode.ts";
/** An availability probe may block dispatch, but cannot choose or persist another route. */
export function selectedVoiceRoute(mode: VoiceRoutingMode, localAvailable: boolean) {
  if (mode === "orchestrator" && !localAvailable) return { ok: false as const, mode,
    error: "The selected local answer engine is unavailable. Orchestrator remains selected. Retry it or explicitly choose Direct in Voice settings." };
  return { ok: true as const, mode };
}
