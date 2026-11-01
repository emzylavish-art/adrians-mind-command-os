import type { VoiceRoutingMode } from "@/lib/mind/voice/mode";
import { voiceModeLabel } from "@/lib/mind/voice/mode";

/** Always-visible Direct / Orchestrator badge with toggle. Keeps existing app chrome styles. */
export function VoiceModeBadge(props: {
  mode: VoiceRoutingMode;
  onToggle: () => void;
  listening?: boolean;
}) {
  const label = voiceModeLabel(props.mode);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface px-3 py-2 text-xs"
      data-testid="voice-mode-badge"
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold text-fg">Voice: {label}</span>
      {props.listening ? <span className="text-accent">Listening</span> : <span className="text-muted">Idle</span>}
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
