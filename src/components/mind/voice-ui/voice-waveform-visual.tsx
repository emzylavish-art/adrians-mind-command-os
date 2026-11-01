import { levelToBarPercents } from "./levels-presentational";

/**
 * Visual polish layer for Voice Integration Bot's VoiceWaveform.
 * Same props + data-testid="voice-waveform" so wiring can swap or wrap.
 */
export function VoiceWaveformVisual(props: {
  level: number;
  active?: boolean;
  bars?: number;
  className?: string;
  label?: string;
  /** listening | speaking — changes bar color temperature */
  tone?: "listening" | "speaking" | "idle";
}) {
  const bars = levelToBarPercents(props.active ? props.level : 0, props.bars ?? 7);
  const tone = props.tone ?? (props.active ? "listening" : "idle");
  return (
    <span
      className={`voice-wave-visual inline-flex h-8 items-end gap-0.5 ${props.className ?? ""}`}
      role="img"
      aria-label={props.label ?? (props.active ? "Voice level" : "Voice idle")}
      data-testid="voice-waveform"
      data-active={props.active ? "true" : "false"}
      data-level={props.level.toFixed(3)}
      data-tone={tone}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          className="voice-wave-bar"
          style={{ height: `${height}%`, minHeight: 2, opacity: props.active ? 1 : 0.35 }}
        />
      ))}
    </span>
  );
}
