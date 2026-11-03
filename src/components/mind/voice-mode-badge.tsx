import type { VoiceRoutingMode } from "@/lib/mind/voice/mode";
import { voiceModeLabel } from "@/lib/mind/voice/mode";
import type { LiveVoiceUiAttr } from "@/lib/mind/voice-live/types";

function sessionStatusLabel(
  active: boolean,
  uiAttr: LiveVoiceUiAttr | "off" | null | undefined,
  listeningFallback?: boolean,
): string {
  if (active && uiAttr && uiAttr !== "off") {
    switch (uiAttr) {
      case "connecting":
        return "Connecting";
      case "listening":
        return "Listening";
      case "user-speaking":
        return "You're speaking";
      case "assistant-speaking":
        return "Speaking";
      case "interrupted":
        return "Interrupted";
      case "muted":
        return "Muted";
      case "error":
        return "Error";
      default:
        return "Live";
    }
  }
  if (listeningFallback) return "Listening";
  return "Idle";
}

/** Always-visible Direct / Orchestrator badge with toggle. Keeps existing app chrome styles. */
export function VoiceModeBadge(props: {
  mode: VoiceRoutingMode;
  onToggle: () => void;
  listening?: boolean;
  /** Live-call ui attr from LiveVoiceBar — wins over Idle when a call is active. */
  sessionActive?: boolean;
  sessionUiAttr?: LiveVoiceUiAttr | "off" | null;
  /** Extra status (e.g. Ollama unreachable) shown next to Idle/Listening. */
  detail?: string | null;
  detailTone?: "muted" | "warn" | "danger";
  /** Live finals are POSTed to an active BuildSession. */
  steeringBuild?: boolean;
}) {
  const label = voiceModeLabel(props.mode);
  const status = props.steeringBuild
    ? "Steering build"
    : sessionStatusLabel(Boolean(props.sessionActive), props.sessionUiAttr, props.listening);
  const liveTone =
    props.sessionActive && props.sessionUiAttr && props.sessionUiAttr !== "off"
      ? "text-accent"
      : props.listening
        ? "text-accent"
        : "text-muted";
  const tone =
    props.detailTone === "danger"
      ? "text-danger"
      : props.detailTone === "warn"
        ? "text-amber-300"
        : "text-muted";
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface px-3 py-2 text-xs"
      data-testid="voice-mode-badge"
      data-mode={props.mode}
      data-session={props.sessionUiAttr || (props.sessionActive ? "live" : "off")}
      data-detail={props.detail ? "true" : "false"}
      data-steering-build={props.steeringBuild ? "true" : "false"}
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold text-fg">Voice: {label}</span>
      <span className={liveTone} data-testid="voice-mode-badge-status">
        {status}
      </span>
      {props.detail ? (
        <span className={tone} data-testid="voice-mode-badge-detail">
          {props.detail}
        </span>
      ) : null}
      <button
        type="button"
        className="min-h-9 rounded-panel border border-line px-2 text-xs"
        onClick={props.onToggle}
        aria-label={`Switch voice mode (currently ${label})`}
        data-testid="voice-mode-toggle"
      >
        Switch to {props.mode === "direct" ? "Orchestrator" : "Direct"}
      </button>
    </div>
  );
}
