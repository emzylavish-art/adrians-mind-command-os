import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, RotateCcw } from "lucide-react";
import {
  createWhisperSession,
  type WhisperSession,
} from "@/lib/mind/whisper-flow/session";
import type { WhisperFlowState } from "@/lib/mind/whisper-flow/types";
import { createWhisperFlowState } from "@/lib/mind/whisper-flow/machine";
import { mapSttClientError, STT_SIGN_IN_REQUIRED } from "@/lib/mind/whisper-flow/stt-client-errors";
import { refineDictationOptional, transcribeDictation } from "@/lib/mind/server";
import { VoiceWaveform } from "@/components/mind/voice-waveform";
import type { SttProviderId } from "@/lib/mind/whisper-flow/provider";

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
  freeOnly?: boolean;
};

/**
 * Whisper Flow controls: Handy capture. Browser speech is not started.
 * Start / Pause / Resume / Stop — never auto-submits.
 */
export function WhisperFlowBar(props: WhisperFlowBarProps) {
  const [state, setState] = useState<WhisperFlowState>(() => createWhisperFlowState());
  const [interim, setInterim] = useState("");
  const [llmEnabled, setLlmEnabled] = useState(props.llmRefineEnabled === true);
  const [llmStatus, setLlmStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState<SttProviderId>("handy");
  const [fallbackProvider, setFallbackProvider] = useState<SttProviderId | null>(null);
  const [actualProvider, setActualProvider] = useState<string | null>(null);
  const sessionRef = useRef<WhisperSession | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (typeof props.llmRefineEnabled === "boolean") setLlmEnabled(props.llmRefineEnabled);
  }, [props.llmRefineEnabled]);

  useEffect(() => {
    const session: WhisperSession = createWhisperSession({
      onState: setState,
      onInterim: setInterim,
      onUndoLastSegment: () => propsRef.current.onUndoLastSegment?.(),
      llmRefineEnabled: llmEnabled,
      llmRefine:
        propsRef.current.llmRefine ||
        (async (text: string) => {
          if (propsRef.current.freeOnly) return null;
          try {
            const result = await refineDictationOptional({ data: { text, enabled: true, freeOnly: propsRef.current.freeOnly === true } });
            if (!result || typeof result !== "object") {
              setLlmStatus("Optional LLM refinement failed. Local refinement was kept.");
              return null;
            }
            if ("ok" in result && result.ok === true && "text" in result) {
              const polished = String((result as { text?: string }).text || "").trim();
              setLlmStatus(
                polished && polished !== text
                  ? "Optional LLM refinement ready (local text already inserted; not auto-replaced)."
                  : "Optional LLM refinement matched local text.",
              );
              return polished || null;
            }
            const err = String((result as { error?: string }).error || "Optional LLM refinement skipped.");
            setLlmStatus(err);
            return null;
          } catch (err) {
            const mapped = mapSttClientError(err);
            setLlmStatus(
              /Sign in to use server transcription/i.test(mapped)
                ? "Sign in to use optional LLM refinement. Local refinement was kept."
                : "Optional LLM refinement failed. Local refinement was kept.",
            );
            return null;
          }
        }),
      transcribe: async (input) => {
        // E2E override — never used in production paths unless window flag set.
        const e2e = (window as unknown as {
          __whisperFlowE2E?: {
            transcribe?: (i: typeof input) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
            forceMicDenied?: boolean;
            forceSttUnauthorized?: boolean;
          };
        }).__whisperFlowE2E;
        if (e2e?.forceMicDenied) {
          return { ok: false, error: "Microphone permission was denied. Allow the mic for this site, then Retry. Nothing was transcribed." };
        }
        if (e2e?.forceSttUnauthorized) {
          return { ok: false, error: STT_SIGN_IN_REQUIRED };
        }
        if (e2e?.transcribe) return e2e.transcribe(input);
        if (sessionRef.current !== session) return { ok: false, error: "Transcription selection changed. Start dictation again." };
        try {
          const result = await transcribeDictation({
            data: {
              audioBase64: input.audioBase64,
              mime: input.mime,
              filename: input.filename,
              provider,
              fallbackProvider,
              freeOnly: propsRef.current.freeOnly === true,
            },
          });
          if (sessionRef.current !== session) return { ok: false, error: "Transcription selection changed. The earlier result was not inserted." };
          if (!result || typeof result !== "object") {
            return { ok: false, error: "Speech-to-text returned an unreadable response. Nothing was transcribed." };
          }
          if ("ok" in result && result.ok === false) {
            return { ok: false, error: mapSttClientError({ error: String((result as { error?: string }).error || "Transcription failed.") }) };
          }
          const text = String((result as { text?: string }).text || "").trim();
          if (!text) return { ok: false, error: "No words were recognized. Nothing was inserted." };
          setActualProvider((result as { provider?: string }).provider ?? "not reported");
          return { ok: true, text, provider: (result as { provider?: string }).provider };
        } catch (err) {
          return { ok: false, error: mapSttClientError(err) };
        }
      },
      onInserted: () => {
        const active = document.activeElement;
        const onSync = propsRef.current.onComposerSync;
        if (
          onSync &&
          active instanceof HTMLTextAreaElement &&
          active.className.includes("input-glow")
        ) {
          onSync(active.value);
        }
      },
    });
    sessionRef.current = session;
    return () => {
      session.cancel();
      sessionRef.current = null;
    };
  }, [llmEnabled, provider, fallbackProvider]);

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
      title={`Whisper Flow sends recordings to ${provider === "handy" ? "Handy local" : provider}. ${fallbackProvider ? `One fallback to ${fallbackProvider} is permitted.` : "Alternate-provider fallback is off."}`}
    >
      <label className="text-xs text-muted">Transcription
        <select aria-label="Whisper Flow transcription provider" value={provider} disabled={props.disabled || (phase !== "idle" && phase !== "error")} onChange={(event) => {
          const next = event.target.value as SttProviderId;
          setProvider(next); setActualProvider(null);
          if (fallbackProvider === next) setFallbackProvider(null);
        }}>
          <option value="handy">Handy local</option>
          <option value="xai" disabled={props.freeOnly}>xAI cloud</option>
          <option value="openai" disabled={props.freeOnly}>OpenAI cloud</option>
        </select>
      </label>
      <label className="text-xs text-muted">Allowed fallback
        <select aria-label="Whisper Flow allowed fallback" value={fallbackProvider ?? "none"} disabled={props.disabled || (phase !== "idle" && phase !== "error")} onChange={(event) => setFallbackProvider(event.target.value === "none" ? null : event.target.value as SttProviderId)}>
          <option value="none">None</option>
          {provider !== "handy" && <option value="handy">Handy local</option>}
          {provider !== "xai" && <option value="xai" disabled={props.freeOnly}>xAI cloud</option>}
          {provider !== "openai" && <option value="openai" disabled={props.freeOnly}>OpenAI cloud</option>}
        </select>
      </label>
      <span className="text-xs text-muted">{provider === "handy" ? "Recording goes to Handy local." : `Recording goes to ${provider === "xai" ? "xAI" : "OpenAI"} cloud; provider charges may apply.`}{fallbackProvider ? ` If it fails, one attempt may go to ${fallbackProvider}.` : " No alternate upload is allowed."}{actualProvider ? ` Last transcript: ${actualProvider}.` : ""}</span>
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
      <label className="inline-flex min-h-9 items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
        <input
          type="checkbox"
          className="size-3"
          data-testid="whisper-flow-llm-toggle"
          checked={llmEnabled}
          disabled={props.disabled || props.freeOnly}
          onChange={(event) => {
            setLlmEnabled(event.target.checked);
            setLlmStatus(
              event.target.checked
                ? "Optional LLM refinement on. Local text still inserts first; polish never blocks."
                : "Optional LLM refinement off. Local refinement only.",
            );
          }}
        />
        LLM polish
      </label>
      {llmEnabled ? (
        <span className="sr-only" data-testid="whisper-flow-llm-flag">
          Optional LLM refinement enabled; local refinement always inserts first.
        </span>
      ) : null}
      {llmStatus ? (
        <span className="max-w-[12rem] truncate text-[10px] text-muted" data-testid="whisper-flow-llm-status">
          {llmStatus}
        </span>
      ) : null}
    </div>
  );
}
