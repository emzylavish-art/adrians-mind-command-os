import type { ReactNode } from "react";
import { VoiceWaveformVisual } from "./voice-waveform-visual";

export type VoiceUiState = "idle" | "listening" | "thinking" | "speaking" | "interrupted";

/**
 * Immersive hands-free VOICE MODE surface (assistant can speak back).
 * Drive with `state` + optional `level` (0..1). Contract: data-voice-state.
 * When `open` is false, renders nothing. Default open=true for harness use.
 */
export function VoiceModeStage(props: {
  state: VoiceUiState;
  level?: number;
  modeLabel?: string;
  onEnd?: () => void;
  onMute?: () => void;
  muted?: boolean;
  open?: boolean;
  overlay?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  if (props.open === false) return null;
  const level = props.level ?? (props.state === "idle" || props.state === "thinking" ? 0.12 : 0.55);
  const active = props.state === "listening" || props.state === "speaking" || props.state === "interrupted";
  const tone = props.state === "speaking" || props.state === "interrupted" ? "speaking" : props.state === "listening" ? "listening" : "idle";
  const status =
    props.state === "listening"
      ? "Listening…"
      : props.state === "thinking"
        ? "Thinking…"
        : props.state === "speaking"
          ? "Speaking…"
          : props.state === "interrupted"
            ? "Interrupted"
            : "Voice mode";

  const stage = (
    <div
      className={`voice-mode-stage ${props.className ?? ""}`}
      data-voice-state={props.state}
      data-testid="voice-mode-stage"
      role="dialog"
      aria-label="Voice mode"
      aria-live="polite"
    >
      <div className="voice-mode-stage__glow" aria-hidden="true" />
      <div className={`voice-mode-orb voice-mode-orb--${props.state}`} aria-hidden="true">
        <div className="voice-mode-orb__core" />
        <div className="voice-mode-orb__ring" />
        <div className="voice-mode-orb__ring voice-mode-orb__ring--delay" />
      </div>
      <div className="voice-mode-stage__wave">
        <VoiceWaveformVisual level={level} active={active} bars={11} tone={tone} label={status} />
      </div>
      <p className="voice-mode-stage__status">{status}</p>
      {props.modeLabel ? <p className="voice-mode-stage__mode">{props.modeLabel}</p> : null}
      {props.state === "interrupted" ? <span className="voice-mode-chip" data-testid="voice-interrupted-chip">Interrupted</span> : null}
      <div className="voice-mode-stage__controls">
        <button type="button" className="voice-mode-btn" onClick={props.onMute} aria-pressed={props.muted} data-testid="voice-mode-mute">
          {props.muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" className="voice-mode-btn voice-mode-btn--end" onClick={props.onEnd} data-testid="voice-mode-end">
          End
        </button>
      </div>
      {props.children}
    </div>
  );

  if (props.overlay) {
    return (
      <div className="voice-mode-overlay-shell" data-testid="voice-overlay" role="presentation">
        {stage}
      </div>
    );
  }
  return stage;
}
