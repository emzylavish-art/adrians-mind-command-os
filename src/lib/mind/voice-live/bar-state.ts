/**
 * Presentational mapping for the persistent live-voice bar root attrs.
 */
import type { LiveVoiceUiAttr } from "./types.ts";

export type LiveVoiceBarUiState = LiveVoiceUiAttr;

export function clampLiveLevel(n: number | undefined | null): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export function muteButtonAria(active: boolean, muted: boolean): {
  label: "Mute" | "Unmute" | "Start live voice";
  pressed: boolean;
} {
  if (!active) return { label: "Start live voice", pressed: false };
  if (muted) return { label: "Unmute", pressed: true };
  return { label: "Mute", pressed: false };
}

export function barRootStyle(level: number): { ["--live-level"]: string } {
  return { ["--live-level"]: String(clampLiveLevel(level)) };
}
