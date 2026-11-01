/**
 * Presentational Grok-like live voice bottom bar (in-call).
 * Dual-classed for Voice Wiring hooks:
 *   .live-voice-bar.live-voice-control[data-live-voice] + --live-level
 *   .live-call-grid > .live-call-pill  (+ .live-call-end)
 * Pure chrome — no audio/stream/session logic.
 */

import type { ReactNode } from "react";
import type { LiveSpeakState } from "./live-speak-control";

export type { LiveSpeakState };

const STATUS: Record<LiveSpeakState, string> = {
  off: "Live voice off",
  connecting: "Connecting",
  listening: "Listening",
  "user-speaking": "You're speaking",
  "assistant-speaking": "Assistant speaking",
  interrupted: "Interrupted",
  muted: "Muted",
  error: "Voice error",
};

function clampLevel(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export type LiveVoiceBarProps = {
  state: LiveSpeakState;
  level?: number;
  askSlot?: ReactNode;
  placeholder?: string;
  plusOpen?: boolean;
  disabled?: boolean;
  className?: string;
  onMute?: () => void;
  onEnd?: () => void;
  onSpeaker?: () => void;
  onScreenShare?: () => void;
  onSettings?: () => void;
  onPlus?: () => void;
  onPlusItem?: (id: "camera" | "photo" | "video" | "files") => void;
  onAskFocus?: () => void;
};

const PLUS_ITEMS = [
  { id: "camera" as const, label: "Camera" },
  { id: "photo" as const, label: "Photo" },
  { id: "video" as const, label: "Video" },
  { id: "files" as const, label: "Files" },
];

export function LiveVoiceBar(props: LiveVoiceBarProps) {
  const state = props.state;
  const level = clampLevel(props.level);
  const style = { ["--live-level" as string]: String(level) };
  const muted = state === "muted";
  const status = STATUS[state];

  return (
    <div
      className={`live-voice-bar live-voice-control ${props.className ?? ""}`.trim()}
      data-live-voice={state}
      data-state={state}
      data-testid="live-voice-bar"
      role="region"
      aria-label={`Live voice bar — ${status}`}
      style={style}
    >
      <div className="live-voice-bar__glass" aria-hidden="true" />

      <div
        className="live-voice-bar__controls live-call-grid"
        role="group"
        aria-label="Live voice tools"
      >
        <button
          type="button"
          className="live-voice-bar__round live-call-pill"
          data-testid="live-voice-bar-screen"
          aria-label="Screen share"
          onClick={props.onScreenShare}
          disabled={props.disabled}
        >
          <span className="lvb-ico lvb-ico--screen" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="live-voice-bar__round live-call-pill"
          data-testid="live-voice-bar-speaker"
          aria-label="Speaker"
          onClick={props.onSpeaker}
          disabled={props.disabled}
        >
          <span className="lvb-ico lvb-ico--speaker" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="live-voice-bar__round live-voice-bar__mic live-call-pill"
          data-testid="live-voice-bar-mute"
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          onClick={props.onMute}
          disabled={props.disabled}
        >
          <span className="live-voice-bar__mic-ring" aria-hidden="true" />
          <span className={`lvb-ico lvb-ico--mic${muted ? " is-slashed" : ""}`} aria-hidden="true" />
          <span className="live-voice-bar__mic-dot" aria-hidden="true" />
          <span className="live-voice-bar__mic-dots" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
        </button>
        <button
          type="button"
          className="live-voice-bar__round live-call-pill"
          data-testid="live-voice-bar-settings"
          aria-label="Voice settings"
          onClick={props.onSettings}
          disabled={props.disabled}
        >
          <span className="lvb-ico lvb-ico--settings" aria-hidden="true" />
        </button>
      </div>

      <div className="live-voice-bar__composer">
        <div className="live-voice-bar__plus-wrap">
          <button
            type="button"
            className="live-voice-bar__plus"
            data-testid="live-voice-bar-plus"
            aria-label="Add attachment"
            aria-expanded={!!props.plusOpen}
            onClick={props.onPlus}
            disabled={props.disabled}
          >
            <span className="lvb-ico lvb-ico--plus" aria-hidden="true" />
          </button>
          {props.plusOpen ? (
            <ul className="live-voice-bar__plus-menu" role="menu" aria-label="Add media">
              {PLUS_ITEMS.map((item) => (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="live-voice-bar__plus-item"
                    data-testid={`live-voice-bar-attach-${item.id}`}
                    onClick={() => props.onPlusItem?.(item.id)}
                  >
                    <span className={`lvb-ico lvb-ico--${item.id}`} aria-hidden="true" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="live-voice-bar__ask" data-testid="live-voice-bar-input">
          {props.askSlot ?? (
            <button
              type="button"
              className="live-voice-bar__ask-fake"
              onClick={props.onAskFocus}
              aria-label={props.placeholder ?? "Ask Anything"}
            >
              {props.placeholder ?? "Ask Anything"}
            </button>
          )}
        </div>

        <button
          type="button"
          className="live-voice-bar__end live-call-end"
          data-testid="live-voice-bar-end"
          aria-label="End call"
          onClick={props.onEnd}
          disabled={props.disabled}
        >
          <span className="lvb-ico lvb-ico--hangup" aria-hidden="true" />
        </button>
      </div>

      <span className="live-voice-bar__sr" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
