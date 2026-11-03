/**
 * Bind presentational LiveVoiceBar (voice-ui) callbacks to one useLiveVoiceSession.
 * Voice Integration still mounts markPreview stubs for mute/end/speaker/screenshare/
 * settings/plus/ask — this helper replaces those with real session + composer actions
 * so both lanes share one session rather than a second fake chrome path.
 *
 * Compatible with origin/voice-integration f342bea useLiveVoiceSession return shape,
 * plus N1 attachDisplayAudio / setScreenAudioMixEnabled when present.
 */

import type { LiveVoiceUiAttr } from "./types.ts";

export type PresentationalBarPlusId = "camera" | "photo" | "video" | "files";

/** Subset of useLiveVoiceSession() used by the presentational bar. */
export type LiveVoiceSessionBarApi = {
  toggleMute: () => void;
  end: (notice?: string) => void;
  toggleSpeaker: () => void;
  uiAttr?: LiveVoiceUiAttr | string;
  level?: number;
  muted?: boolean;
  active?: boolean;
  /** N1 — mix getDisplayMedia audio into the realtime mic graph. */
  attachDisplayAudio?: (stream: MediaStream) => void;
  detachDisplayAudio?: (opts?: { stopTracks?: boolean }) => void;
  setScreenAudioMixEnabled?: (enabled: boolean) => void;
};

export type PresentationalLiveVoiceBarBound = {
  state: string;
  level: number;
  onMute: () => void;
  onEnd: () => void;
  onSpeaker: () => void;
  onScreenShare: () => void;
  onSettings: () => void;
  onPlus: () => void;
  onPlusItem: (id: PresentationalBarPlusId) => void;
  onAskFocus: () => void;
};

export type BindPresentationalLiveVoiceBarInput = {
  session: LiveVoiceSessionBarApi;
  /**
   * Must call getDisplayMedia in the click stack (user activation), then
   * session.attachDisplayAudio(stream) when audio tracks exist (N1).
   */
  onScreenShare: () => void;
  /** Open voice settings (popover / sheet). */
  onSettings: () => void;
  /** Composer plus / attachment entry. */
  onPlus: () => void;
  onPlusItem?: (id: PresentationalBarPlusId) => void;
  /** Focus Ask Anything / composer draft. */
  onAskFocus?: () => void;
};

function resolveState(session: LiveVoiceSessionBarApi): string {
  if (session.muted) return "muted";
  const attr = session.uiAttr || (session.active ? "listening" : "off");
  return String(attr);
}

/**
 * Map one live session + composer actions → props for voice-ui LiveVoiceBar.
 * Never returns markPreview toast stubs.
 */
export function bindPresentationalLiveVoiceBar(
  input: BindPresentationalLiveVoiceBarInput,
): PresentationalLiveVoiceBarBound {
  const { session } = input;
  return {
    state: resolveState(session),
    level: typeof session.level === "number" ? session.level : 0,
    onMute: () => {
      session.toggleMute();
    },
    onEnd: () => {
      session.end("Live voice ended.");
    },
    onSpeaker: () => {
      session.toggleSpeaker();
    },
    onScreenShare: () => {
      input.onScreenShare();
    },
    onSettings: () => {
      input.onSettings();
    },
    onPlus: () => {
      input.onPlus();
    },
    onPlusItem: (id) => {
      input.onPlusItem?.(id);
    },
    onAskFocus: () => {
      input.onAskFocus?.();
    },
  };
}

/** Strings that must never appear as markPreview toast labels for live-bar chrome. */
export const FORBIDDEN_MARK_PREVIEW_LIVE_BAR = [
  "Live bar mute",
  "Live bar end",
  "Speaker",
  "Screen share",
  "Voice settings",
  "Add attachment",
  "Live bar ask",
  "Live speak",
  "Speak",
  "Voice mode end",
] as const;
