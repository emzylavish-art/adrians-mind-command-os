import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, RotateCcw } from "lucide-react";
import {
  createWhisperSession,
  type WhisperSession,
} from "@/lib/mind/whisper-flow/session";
import type { WhisperFlowState } from "@/lib/mind/whisper-flow/types";
import { createWhisperFlowState } from "@/lib/mind/whisper-flow/machine";
import { transcribeDictation } from "@/lib/mind/server";
import { VoiceWaveform } from "@/components/mind/voice-waveform";

export type WhisperFlowBarProps = {
  disabled?: boolean;
  className?: string;
  /** When true, attempt optional non-blocking LLM refine after local insert. */
  llmRefineEnabled?: boolean;
  /** Optional LLM refine (server). Must never block insertion. */
  llmRefine?: (text: string) => Promise<string | null>;
  /** Sync inserted text into composer React state when the target is the composer. */
  onComposerSync?: (value: string) => void;
  /** Undo last segment in composer (scratch that). */
  onUndoLastSegment?: () => void;
  compact?: boolean;
};

/**
 * Whisper Flow controls: browser speech primary; server STT fallback.
 * Start / Pause / Resume / Stop — never auto-submits.
 */
export function WhisperFlowBar(props: WhisperFlowBarProps) {
  const [state, setState] = useState<WhisperFlowState>(() => createWhisperFlowState());
  const [interim, setInterim] = useState("");
  const sessionRef = useRef<WhisperSession | null>(null);
  const llmEnabled = props.llmRefineEnabled === true;

  useEffect(() => {
    const session = createWhisperSession({
      onState: setState,
      onInterim: setInterim,
      onUndoLastSegment: props.onUndoLastSegment,
      llmRefineEnabled: llmEnabled,
      llmRefine: props.llmRefine,
      transcribe: async (input) => {
        // E2E override — never used in production paths unless window flag set.
        const e2e = (window as unknown as {
          __whisperFlowE2E?: {
            transcribe?: (i: typeof input) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
            forceMicDenied?: boolean;
          };
        }).__whisperFlowE2E;
        if (e2e?.forceMicDenied) {
          return { ok: false, error: "Microphone permission was denied. Allow the mic for this site, then Retry. Nothing was transcribed." };
        }
        if (e2e?.transcribe) return e2e.transcribe(input);
        try {
          const result = await transcribeDictation({
            data: {
              audioBase64: input.audioBase64,
              mime: input.mime,
              filename: input.filename,
            },
          });
          if (!result || typeof result !== "object") {
            return { ok: false, error: "Speech-to-text returned an unreadable response. Nothing was transcribed." };
          }
          if ("ok" in result && result.ok === false) {
            return { ok: false, error: String((result as { error?: string }).error || "Transcription failed.") };
          }
          const text = String((result as { text?: string }).text || "").trim();
          if (!text) return { ok: false, error: "No words were recognized. Nothing was inserted." };
          return { ok: true, text, provider: (result as { provider?: string }).provider };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/unauthorized|sign in/i.test(message)) {
            return {
              ok: false,
              error: "Sign in is required for server speech-to-text. Browser speech still works when available. Nothing was transcribed via the server.",
            };
          }
          return { ok: false, error: message || "Speech-to-text failed. Nothing was transcribed." };
        }
      },
      onInserted: () => {
        // Composer sync: if active element is a textarea the parent controls, read value.
        const active = document.activeElement;
        if (
          props.onComposerSync &&
          active instanceof HTMLTextAreaElement &&
          active.className.includes("input-glow")
        ) {
          props.onComposerSync(active.value);
        }
      },
    });
    sessionRef.current = session;
    return () => {
      session.cancel();
      sessionRef.current = null;
    };
    // Intentionally once — handlers read from props via closure updates on each render through ref pattern would be better;
    // recreate only on llm toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmEnabled]);

  // Keyboard: Alt+Shift+D toggles start/stop when focused in app
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === "d")) return;
      if (props.disabled) return;
      event.preventDefault();
      const session = sessionRef.current;
      if (!session) return;
      const phase = session.getState().phase;
      if (phase === "idle" || phase === "error") void session.start();
      else void session.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.disabled]);

  const phase = state.phase;
  const listening = phase === "listening" || phase === "transcribing";
  const paused = phase === "paused";
  const errored = phase === "error";

  return (
    <div
      className={`inline-flex max-w-full flex-wrap items-center gap-2 ${props.className ?? ""}`}
      data-testid="whisper-flow-bar"
      data-whisper-phase={phase}
      title="Whisper Flow: browser speech primary; server STT fallback. Never auto-sends."
    >
      <button
        type="button"
        className={`grid size-11 place-items-center rounded-panel border border-line ${
          listening ? "bg-accent text-accent-ink" : errored ? "border-danger text-danger" : "text-muted"
        }`}
        data-testid="whisper-flow-start"
        aria-label={listening ? "Whisper Flow listening" : "Start Whisper Flow dictation"}
        aria-pressed={listening || paused}
        disabled={props.disabled || phase === "transcribing"}
        onClick={() => {
          if (phase === "idle" || phase === "error") void sessionRef.current?.start();
        }}
      >
        <Mic className="size-4" />
      </button>

      {phase !== "idle" ? (
        <div
          className="inline-flex min-h-11 max-w-[min(100%,22rem)] flex-wrap items-center gap-2 rounded-panel border border-line bg-surface px-2"
          data-testid="whisper-flow-pill"
          role="status"
          aria-live="polite"
        >
          <span
            className={`size-2 shrink-0 rounded-full ${listening ? "bg-danger" : paused ? "bg-warn" : errored ? "bg-danger" : "bg-muted"}`}
            aria-hidden="true"
          />
          <VoiceWaveform level={state.level} active={listening} bars={5} label={phase} />
          <span className="max-w-[9rem] truncate text-xs text-muted" data-testid="whisper-flow-status">
            {errored ? state.error : interim || state.status || phase}
          </span>
          {listening ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-panel border border-line px-2 text-xs"
              data-testid="whisper-flow-pause"
              aria-label="Pause dictation"
              onClick={() => sessionRef.current?.pause()}
            >
              <Pause className="size-3" />
              Pause
            </button>
          ) : null}
          {paused ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-panel border border-line px-2 text-xs"
              data-testid="whisper-flow-resume"
              aria-label="Resume dictation"
              onClick={() => sessionRef.current?.resume()}
            >
              <Play className="size-3" />
              Resume
            </button>
          ) : null}
          {phase !== "error" ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-panel border border-line px-2 text-xs"
              data-testid="whisper-flow-stop"
              aria-label="Stop dictation"
              onClick={() => void sessionRef.current?.stop()}
            >
              <Square className="size-3" />
              Stop
            </button>
          ) : null}
          {errored && state.retryable ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-panel border border-line px-2 text-xs"
              data-testid="whisper-flow-retry"
              aria-label="Retry Whisper Flow"
              onClick={() => void sessionRef.current?.start()}
            >
              <RotateCcw className="size-3" />
              Retry
            </button>
          ) : null}
        </div>
      ) : props.compact ? null : (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Whisper Flow</span>
      )}
      {llmEnabled ? (
        <span className="sr-only" data-testid="whisper-flow-llm-flag">
          Optional LLM refinement enabled; local refinement always inserts first.
        </span>
      ) : null}
    </div>
  );
}
