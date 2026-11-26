import { ElapsedTime } from "@/components/mind/elapsed-time";
import { VoiceWaveformVisual } from "./voice-waveform-visual";

export type DictationUiState = "idle" | "recording" | "transcribing";

/**
 * MIC-TO-SPEAK dictation affordance for the composer (input only — no orb / no speaking).
 * Contract: data-dictation="idle|recording|transcribing"
 */
export function DictationPill(props: {
  state: DictationUiState;
  level?: number;
  elapsedSec?: number;
  startedAt?: number | null;
  onStart?: () => void;
  onStop?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const recording = props.state === "recording";
  const transcribing = props.state === "transcribing";
  const level = props.level ?? (recording ? 0.45 : 0);

  if (props.state === "idle") {
    return (
      <button
        type="button"
        className={`dictation-mic ${props.className ?? ""}`}
        data-dictation="idle"
        data-testid="dictation-pill"
        aria-label="Dictate into composer"
        onClick={props.onStart}
        disabled={props.disabled}
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
      <span className="dictation-pill__timer font-mono">{transcribing ? "…" : <ElapsedTime startedAt={props.startedAt} seconds={props.elapsedSec ?? 0} clock />}</span>
      <button type="button" className="dictation-pill__stop" onClick={props.onStop} aria-label="Stop dictation" data-testid="dictation-stop">
        Stop
      </button>
      {transcribing ? null : (
        <button type="button" className="dictation-pill__confirm" onClick={props.onConfirm ?? props.onStop} aria-label="Use transcript" data-testid="dictation-confirm">
          Done
        </button>
      )}
      {props.onCancel ? (
        <button type="button" className="dictation-pill__stop" onClick={props.onCancel} aria-label="Cancel dictation" data-testid="dictation-cancel" disabled={transcribing}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}
