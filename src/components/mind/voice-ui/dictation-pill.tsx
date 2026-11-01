import { VoiceWaveformVisual } from "./voice-waveform-visual";

export type DictationUiState = "idle" | "recording" | "transcribing";

/**
 * MIC-TO-SPEAK dictation affordance for the composer (input only — no orb / no speaking).
 * Contract: data-dictation="idle|recording|transcribing"
 * Props align with wiring: level 0..1, elapsedSec optional timer.
 */
export function DictationPill(props: {
  state: DictationUiState;
  level?: number;
  elapsedSec?: number;
  onStart?: () => void;
  onStop?: () => void;
  onConfirm?: () => void;
  className?: string;
}) {
  const recording = props.state === "recording";
  const transcribing = props.state === "transcribing";
  const level = props.level ?? (recording ? 0.45 : 0);
  const mm = Math.floor((props.elapsedSec ?? 0) / 60);
  const ss = String((props.elapsedSec ?? 0) % 60).padStart(2, "0");

  if (props.state === "idle") {
    return (
      <button
        type="button"
        className={`dictation-mic ${props.className ?? ""}`}
        data-dictation="idle"
        data-testid="dictation-pill"
        aria-label="Dictate"
        onClick={props.onStart}
      >
        <span className="dictation-mic__icon" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className={`dictation-pill ${props.className ?? ""}`}
      data-dictation={props.state}
      data-testid="dictation-pill"
      role="status"
      aria-live="polite"
    >
      <span className={`dictation-pill__dot ${recording ? "is-live" : ""}`} aria-hidden="true" />
      <VoiceWaveformVisual level={level} active={recording} bars={5} tone="listening" className="dictation-pill__wave" />
      <span className="dictation-pill__timer font-mono">{transcribing ? "…" : `${mm}:${ss}`}</span>
      <button type="button" className="dictation-pill__stop" onClick={props.onStop} aria-label="Stop dictation" data-testid="dictation-stop">
        Stop
      </button>
      {transcribing ? null : (
        <button type="button" className="dictation-pill__confirm" onClick={props.onConfirm} aria-label="Use transcript" data-testid="dictation-confirm">
          Done
        </button>
      )}
    </div>
  );
}
