/**
 * Bind presentational LiveVoiceBar (voice-ui) callbacks to one useLiveVoiceSession.
 * Voice Integration still mounts markPreview stubs for mute/end/speaker/screenshare/
 * settings/plus/ask — this helper replaces those with real session + composer actions
 * so both lanes share one session rather than a second fake chrome path.
 *
 * Compatible with origin/voice-integration f342bea useLiveVoiceSession return shape,
 * plus N1 attachDisplayAudio / setScreenAudioMixEnabled when present.
 *
 * When the session is not connected, mute/end/speaker/screen/mode controls surface an
 * honest notice instead of toast-only markPreview stubs or silent no-ops.
 */

import type { LiveVoiceUiAttr } from "./types.ts";

export type PresentationalBarPlusId = "camera" | "photo" | "video" | "files";

/** Honest copy when a live-bar control fires without an active realtime session. */
export const LIVE_VOICE_NOT_CONNECTED_NOTICE =
  "Live voice is not connected. Tap Speak to start a realtime session first.";

/** Subset of useLiveVoiceSession() used by the presentational bar. */
export type LiveVoiceSessionBarApi = {
  toggleMute: () => void;
  end: (notice?: string) => void;
  toggleSpeaker: () => void;
  uiAttr?: LiveVoiceUiAttr | string;
  level?: number;
  muted?: boolean;
  active?: boolean;
  /** Optional phase for connecting-state honesty. */
  phase?: string;
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
  /** Optional mode switch (Direct ↔ Orchestrator) with disconnect honesty. */
  onModeSwitch: () => void;
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
  /** Toggle Direct ↔ Orchestrator when live (or notice when not). */
  onModeSwitch?: () => void;
  /** Honest notice path — never toast-only markPreview. */
  onNotice?: (message: string) => void;
};

function resolveState(session: LiveVoiceSessionBarApi): string {
  if (session.muted) return "muted";
  const attr = session.uiAttr || (session.active ? "listening" : "off");
  return String(attr);
}

function isSessionLive(session: LiveVoiceSessionBarApi): boolean {
  if (session.active) return true;
  const phase = session.phase || "";
  return (
    phase === "connecting" ||
    phase === "reconnecting" ||
    phase === "listening" ||
    phase === "user_speaking" ||
    phase === "assistant_speaking" ||
    phase === "thinking" ||
    phase === "interrupted" ||
    phase === "muted"
  );
}

/**
 * Map one live session + composer actions → props for voice-ui LiveVoiceBar.
 * Never returns markPreview toast stubs. Disconnected controls notice honestly.
 */
export function bindPresentationalLiveVoiceBar(
  input: BindPresentationalLiveVoiceBarInput,
): PresentationalLiveVoiceBarBound {
  const { session } = input;
  const notice = (msg: string) => {
    input.onNotice?.(msg);
  };
  const requireLive = (action: () => void): void => {
    if (!isSessionLive(session)) {
      notice(LIVE_VOICE_NOT_CONNECTED_NOTICE);
      return;
    }
    action();
  };

  return {
    state: resolveState(session),
    level: typeof session.level === "number" ? session.level : 0,
    onMute: () => {
      requireLive(() => {
        session.toggleMute();
      });
    },
    onEnd: () => {
      if (!isSessionLive(session)) {
        notice(LIVE_VOICE_NOT_CONNECTED_NOTICE);
        return;
      }
      session.end("Live voice ended.");
    },
    onSpeaker: () => {
      requireLive(() => {
        session.toggleSpeaker();
      });
    },
    onScreenShare: () => {
      requireLive(() => {
        input.onScreenShare();
      });
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
    onModeSwitch: () => {
      requireLive(() => {
        if (input.onModeSwitch) {
          input.onModeSwitch();
          return;
        }
        notice(LIVE_VOICE_NOT_CONNECTED_NOTICE);
      });
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
