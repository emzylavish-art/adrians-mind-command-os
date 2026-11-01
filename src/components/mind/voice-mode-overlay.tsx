import { Mic, MicOff, X } from "lucide-react";
import { VoiceWaveform } from "@/components/mind/voice-waveform";
import { voiceModeLabel, type VoiceRoutingMode } from "@/lib/mind/voice/mode";

export type VoiceOverlayPhase = "idle" | "listening" | "processing" | "speaking" | "interrupted";

/**
 * Full-screen voice mode overlay. Wired to realtime capture + TTS by the parent.
 * Presentational Tailwind only — does not touch Visual Polish styles.css / voice-ui/.
 */
export function VoiceModeOverlay(props: {
  open: boolean;
  phase: VoiceOverlayPhase;
  level: number;
  muted: boolean;
  mode: VoiceRoutingMode;
  transcript?: string;
  notice?: string | null;
  error?: string | null;
  onMute: () => void;
  onClose: () => void;
  onInterrupt?: () => void;
}) {
  if (!props.open) return null;
  const status =
    props.phase === "listening"
      ? "Listening…"
      : props.phase === "processing"
        ? "Thinking…"
        : props.phase === "speaking"
          ? "Speaking…"
          : props.phase === "interrupted"
            ? "Interrupted — listening"
            : "Voice mode";
  const active = props.phase === "listening" || props.phase === "speaking" || props.phase === "interrupted";
  const speaking = props.phase === "speaking";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/90 p-4"
      data-testid="voice-overlay"
      data-voice-phase={props.phase}
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-panel border border-line bg-surface p-6 shadow-panel">
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Voice mode</p>
            <p className="text-xs text-muted">
              {voiceModeLabel(props.mode)} · realtime STT · TTS replies
            </p>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-panel border border-line text-muted"
            onClick={props.onClose}
            aria-label="Close voice mode"
            data-testid="voice-overlay-close"
          >
            <X className="size-4" />
          </button>
        </div>

        <VoiceWaveform
          level={props.level}
          active={active}
          bars={11}
          label={status}
          className="h-12"
        />
        <p className="text-sm font-semibold" data-testid="voice-overlay-status">
          {status}
        </p>
        {props.phase === "interrupted" ? (
          <span className="rounded-full border border-line px-2 py-1 text-xs text-accent" data-testid="voice-interrupted-chip">
            Interrupted — listening
          </span>
        ) : null}
        {props.transcript ? (
          <p
            className="max-h-24 w-full overflow-auto rounded-panel border border-line bg-bg px-3 py-2 text-sm"
            data-testid="voice-overlay-transcript"
          >
            {props.transcript}
          </p>
        ) : (
          <p className="text-xs text-muted">Speak after the session connects. Transcripts appear here. Interrupt while it speaks to barge in.</p>
        )}
        {props.notice ? <p className="w-full text-xs text-muted">{props.notice}</p> : null}
        {props.error ? (
          <p className="w-full text-sm text-danger" data-testid="voice-overlay-error">
            {props.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm"
            onClick={props.onMute}
            aria-pressed={props.muted}
            aria-label={props.muted ? "Unmute microphone" : "Mute microphone"}
            data-testid="voice-mute"
          >
            {props.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            {props.muted ? "Unmute" : "Mute"}
          </button>
          {speaking || props.phase === "interrupted" ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-danger/40 px-4 text-sm text-danger"
              onClick={props.onInterrupt}
              aria-label="Interrupt speaking"
              data-testid="voice-interrupt"
              disabled={!speaking}
            >
              Interrupt
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            onClick={props.onClose}
            data-testid="voice-overlay-end"
          >
            End
          </button>
        </div>
      </div>
    </div>
  );
}
