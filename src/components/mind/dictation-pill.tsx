import { Mic, Square, X } from "lucide-react";
import { VoiceWaveform } from "@/components/mind/voice-waveform";

export type DictationUiState = "idle" | "recording" | "transcribing";

/**
 * Composer mic dictation: record → STT → insert text (parent handles insert; never auto-sends).
 * Tailwind-only; does not import Visual Polish voice-ui or styles.css.
 */
export function DictationPill(props: {
  state: DictationUiState;
  level?: number;
  elapsedSec?: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const recording = props.state === "recording";
  const transcribing = props.state === "transcribing";
  const level = props.level ?? (recording ? 0.4 : 0);
  const mm = Math.floor((props.elapsedSec ?? 0) / 60);
  const ss = String((props.elapsedSec ?? 0) % 60).padStart(2, "0");

  if (props.state === "idle") {
    return (
      <button
        type="button"
        className={`grid size-11 place-items-center rounded-panel border border-line text-muted ${props.className ?? ""}`}
        data-testid="mic-button"
        data-dictation="idle"
        aria-label="Dictate into composer"
        onClick={props.onStart}
        disabled={props.disabled}
      >
        <Mic className="size-4" data-testid="dictation-pill" />
      </button>
    );
  }

  return (
    <div
      className={`inline-flex min-h-11 items-center gap-2 rounded-panel border border-line bg-surface px-2 ${props.className ?? ""}`}
      data-dictation={props.state}
      data-testid="dictation-pill"
      role="status"
      aria-live="polite"
    >
      <span
        className={`size-2 rounded-full ${recording ? "bg-danger" : "bg-muted"}`}
        aria-hidden="true"
      />
      <VoiceWaveform level={level} active={recording} bars={5} label={transcribing ? "Transcribing" : "Recording"} />
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
  );
}
