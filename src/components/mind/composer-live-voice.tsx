/**
 * Composer live-voice mount: presentational LiveSpeakControl + wiring hook.
 *
 * Props/DOM match Visual Polish `voice-ui/live-speak-control.tsx` (pass-10 contract)
 * so a post-merge swap is a one-line import change. Do not import styles.css here.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useLiveVoiceSession } from "@/lib/mind/voice-live/use-live-voice-session";
import type { LiveVoiceUiAttr } from "@/lib/mind/voice-live/types";
import { isLiveVoiceOccupied } from "@/lib/mind/voice-live/occupancy";
import { matchesVoiceToggleShortcut } from "@/lib/mind/voice/shortcut";
import {
  getActiveResearchSnapshot,
  subscribeActiveResearch,
  type ResearchVoiceState,
} from "@/lib/mind/voice-live/active-research-run";
import { onVoiceEndConfirmed, onVoiceMuteOrBargeIn } from "@/lib/mind/voice-live/research-voice-end";

/** Same union as Visual Polish LiveSpeakControl (pass-10). */
export type LiveSpeakState =
  | "off"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "assistant-speaking"
  | "interrupted"
  | "muted"
  | "error";

const LABELS: Record<LiveSpeakState, string> = {
  off: "Live voice",
  connecting: "Connecting",
  listening: "Listening",
  "user-speaking": "You're speaking",
  "assistant-speaking": "Speaking",
  interrupted: "Interrupted",
  muted: "Muted",
  error: "Error",
};

function clampLevel(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Presentational control — API-compatible with
 * `@/components/mind/voice-ui/live-speak-control` (Visual Polish).
 * Tailwind here is layout-only; Visual Polish skins via `.live-voice-*` in styles.css.
 */
export function LiveSpeakControl(props: {
  state: LiveSpeakState;
  level?: number;
  label?: string;
  onToggle?: () => void;
  onMute?: () => void;
  onEnd?: () => void;
  className?: string;
  disabled?: boolean;
  /** research-layer: Search | Deep | Running | Done */
  researchState?: ResearchVoiceState | null;
}) {
  const state = props.state;
  const level = clampLevel(props.level);
  const open = state !== "off";
  const statusText = props.label ?? LABELS[state];
  const style = { ["--live-level" as string]: String(Math.round(level * 100) / 100) };

  return (
    <div
      className={`live-voice-control inline-flex max-w-full flex-wrap items-center gap-2 ${props.className ?? ""}`.trim()}
      data-live-voice={state}
      data-state={state}
      data-research-state={props.researchState || undefined}
      data-testid="composer-voice-live"
      style={style}
    >
      {open ? (
        <div className="live-voice-pill inline-flex min-h-9 items-center gap-2 rounded-panel border border-line px-2 text-xs" data-testid="composer-voice-live-state" role="status" aria-live="polite">
          <span className="live-voice-pill__dot" aria-hidden="true" />
          <span className="live-voice-pill__label font-semibold">Live</span>
          <span className="live-voice-pill__status">{statusText}</span>
        </div>
      ) : null}

      <button
        type="button"
        className="live-voice-btn relative grid size-11 shrink-0 place-items-center rounded-full border border-line"
        aria-label={open ? `${statusText}. Toggle live voice` : "Start live voice"}
        aria-pressed={open}
        onClick={props.onToggle}
        disabled={props.disabled}
      >
        <span className="live-voice-btn__ring" aria-hidden="true" />
        <span className="live-voice-bars inline-flex h-4 items-end gap-0.5" aria-hidden="true">
          <i className="inline-block w-1 rounded-sm bg-current" style={{ height: "35%" }} />
          <i className="inline-block w-1 rounded-sm bg-current" style={{ height: "70%" }} />
          <i className="inline-block w-1 rounded-sm bg-current" style={{ height: "100%" }} />
          <i className="inline-block w-1 rounded-sm bg-current" style={{ height: "55%" }} />
          <i className="inline-block w-1 rounded-sm bg-current" style={{ height: "40%" }} />
        </span>
        <span className="live-voice-btn__slash" aria-hidden="true" />
      </button>

      {open ? (
        <div className="live-voice-mini inline-flex items-center gap-1" role="group" aria-label="Live voice controls">
          <button
            type="button"
            className="live-voice-mute min-h-9 rounded-panel border border-line px-2 text-xs"
            data-testid="composer-voice-live-mute"
            aria-label={state === "muted" ? "Unmute live voice" : "Mute live voice"}
            aria-pressed={state === "muted"}
            onClick={props.onMute}
          >
            <span className="live-voice-mute__glyph" aria-hidden="true" />
            {state === "muted" ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className="live-voice-end min-h-9 rounded-panel border border-line px-2 text-xs"
            data-testid="composer-voice-live-end"
            aria-label="End live voice"
            onClick={props.onEnd}
          >
            <span className="live-voice-end__glyph" aria-hidden="true" />
            End
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type ComposerLiveVoiceProps = {
  isOverlayMicOpen: () => boolean;
  stopOverlayMic: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  disabled?: boolean;
};

/** Wired composer mount: logic hook + presentational LiveSpeakControl. */
export function ComposerLiveVoice(props: ComposerLiveVoiceProps) {
  const live = useLiveVoiceSession({
    isOverlayMicOpen: props.isOverlayMicOpen,
    onUserTranscript: props.onUserTranscript,
    onAssistantTranscript: props.onAssistantTranscript,
    onError: props.onError,
    onNotice: props.onNotice,
  });
  const researchSnap = useSyncExternalStore(
    subscribeActiveResearch,
    getActiveResearchSnapshot,
    getActiveResearchSnapshot,
  );

  // Ctrl+Shift+V while live: end live first so two mics never open (no new shortcut).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesVoiceToggleShortcut(event)) return;
      if (!live.active && !isLiveVoiceOccupied()) return;
      event.preventDefault();
      event.stopPropagation();
      live.end();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [live.active, live.end]);

  const onToggle = () => {
    if (!live.active && props.isOverlayMicOpen()) {
      props.stopOverlayMic();
    }
    live.toggle();
  };

  const state = (live.uiAttr || "off") as LiveSpeakState;
  // Prefer Thinking label while internal phase is thinking (attr stays listening).
  const label =
    live.state.phase === "thinking"
      ? "Thinking"
      : live.label !== "Off"
        ? live.label
        : undefined;

  return (
    <div className="inline-flex max-w-full flex-col gap-1">
      <LiveSpeakControl
        state={state}
        level={live.level}
        label={label}
        researchState={researchSnap.state}
        onToggle={onToggle}
        onMute={() => {
          onVoiceMuteOrBargeIn();
          live.toggleMute();
        }}
        onEnd={() => {
          // End confirms abort of in-flight deep research (barge-in/mute do not).
          onVoiceEndConfirmed();
          live.end();
        }}
        disabled={props.disabled}
      />
      {live.error ? (
        <p className="text-xs text-danger" role="alert" data-testid="composer-voice-live-error">
          {live.error}
        </p>
      ) : null}
      {live.active ? (
        <span className="text-[10px] text-muted" data-testid="composer-voice-live-mode">
          {live.modeBadge}
        </span>
      ) : null}
    </div>
  );
}

// Re-export attr alias for wiring types consumers.
export type { LiveVoiceUiAttr };
