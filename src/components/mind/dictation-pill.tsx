import { Mic, Square, X } from "lucide-react";
import { VoiceWaveform } from "@/components/mind/voice-waveform";

export type DictationUiState = "idle" | "recording" | "transcribing";

/**
 * Composer mic dictation: record → STT → insert text (parent handles insert; never auto-sends).
 * Idle: mic-button only. Recording/transcribing: visible dictation-pill with Stop + Cancel.
 * Clicking mic-button while recording also stops (parent onMicClick).
 */
export function DictationPill(props: {
  state: DictationUiState;
  level?: number;
  elapsedSec?: number;
  /** Mic click: start when idle, stop when recording. */
  onMicClick: () => void;
  onStop: () => void;
  onCancel: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const recording = props.state === "recording";
  const transcribing = props.state === "transcribing";
  const active = recording;
  const level = props.level ?? (recording ? 0.4 : 0);
  const mm = Math.floor((props.elapsedSec ?? 0) / 60);
  const ss = String((props.elapsedSec ?? 0) % 60).padStart(2, "0");

  return (
    <div className={`inline-flex flex-wrap items-center gap-2 ${props.className ?? ""}`} data-dictation-root={props.state}>
      <button
        type="button"
        className={`voice-action-dictate inline-flex min-h-11 items-center gap-1.5 rounded-panel border border-line px-2.5 ${recording || transcribing ? "bg-accent text-accent-ink" : "text-muted"}`}
        data-testid="mic-button"
        data-voice-action="dictate"
        data-dictation={props.state}
        aria-label={recording ? "Stop dictation" : transcribing ? "Transcribing dictation" : "Dictate into composer"}
        aria-pressed={recording || transcribing}
        onClick={props.onMicClick}
        disabled={props.disabled || transcribing}
      >
        {recording || transcribing ? <Square className="size-4 shrink-0" aria-hidden="true" /> : <Mic className="size-4 shrink-0" aria-hidden="true" />}
        <span className="voice-action-dictate__label text-[10px] font-semibold uppercase tracking-wide">
          {recording ? "Stop" : transcribing ? "…" : "Dictate"}
        </span>
      </button>

      {props.state !== "idle" ? (
        <div
          className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line bg-surface px-2"
          data-dictation={props.state}
          data-testid="dictation-pill"
          role="status"
          aria-live="polite"
        >
          <span className={`size-2 shrink-0 rounded-full ${recording ? "bg-danger" : "bg-muted"}`} aria-hidden="true" />
          <VoiceWaveform
            level={level}
            active={active}
            bars={5}
            label={transcribing ? "Transcribing" : "Recording"}
          />
          <span className="font-mono text-xs tabular-nums">{transcribing ? "…" : `${mm}:${ss}`}</span>
          {transcribing ? null : (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-panel border border-line px-2 text-xs"
              onClick={props.onStop}
              aria-label="Stop dictation"
              data-testid="dictation-stop"
            >
              <Square className="size-3" />
              Stop
            </button>
          )}
          <button
            type="button"
            className="grid size-9 place-items-center rounded-panel border border-line text-muted"
            onClick={props.onCancel}
            aria-label="Cancel dictation"
            data-testid="dictation-cancel"
            disabled={transcribing}
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
