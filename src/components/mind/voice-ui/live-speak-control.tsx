/**
 * Presentational Live Speak control for the composer (GPT/Grok-like always-on).
 * Distinct from DictationPill (mic → text) and VoiceModeStage (full-screen overlay).
 *
 * Contract (Voice Wiring):
 *   .live-voice-control[data-live-voice="off|connecting|listening|user-speaking|assistant-speaking|interrupted|muted|error"]
 *   --live-level from level prop (0–1)
 *   children: .live-voice-btn .live-voice-pill .live-voice-bars .live-voice-mute .live-voice-end
 *   testids: composer-voice-live / composer-voice-live-state / -mute / -end
 *
 * Purely presentational — no session logic.
 */

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

export function LiveSpeakControl(props: {
  state: LiveSpeakState;
  level?: number;
  label?: string;
  onToggle?: () => void;
  onMute?: () => void;
  onEnd?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const state = props.state;
  const level = clampLevel(props.level);
  const open = state !== "off";
  const statusText = props.label ?? LABELS[state];
  const style = { ["--live-level" as string]: String(level) };

  return (
    <div
      className={`live-voice-control ${props.className ?? ""}`.trim()}
      data-live-voice={state}
      data-testid="composer-voice-live"
      data-state={state}
      style={style}
    >
      {open ? (
        <div
          className="live-voice-pill"
          data-testid="composer-voice-live-state"
          role="status"
          aria-live="polite"
        >
          <span className="live-voice-pill__dot" aria-hidden="true" />
          <span className="live-voice-pill__label">Live</span>
          <span className="live-voice-pill__status">{statusText}</span>
        </div>
      ) : null}

      <button
        type="button"
        className="live-voice-btn"
        aria-label={open ? `${statusText}. Toggle live voice` : "Start live voice"}
        aria-pressed={open}
        onClick={props.onToggle}
        disabled={props.disabled}
      >
        <span className="live-voice-btn__ring" aria-hidden="true" />
        <span className="live-voice-bars" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </span>
        <span className="live-voice-btn__slash" aria-hidden="true" />
      </button>

      {open ? (
        <div className="live-voice-mini" role="group" aria-label="Live voice controls">
          <button
            type="button"
            className="live-voice-mute"
            data-testid="composer-voice-live-mute"
            aria-label={state === "muted" ? "Unmute live voice" : "Mute live voice"}
            aria-pressed={state === "muted"}
            onClick={props.onMute}
          >
            <span className="live-voice-mute__glyph" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="live-voice-end"
            data-testid="composer-voice-live-end"
            aria-label="End live voice"
            onClick={props.onEnd}
          >
            <span className="live-voice-end__glyph" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
