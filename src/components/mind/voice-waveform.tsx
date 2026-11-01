import { levelToBarPercents } from "@/lib/mind/voice/levels";

/** Real audio-level bars for listening / speaking. Not a decorative CSS loop. */
export function VoiceWaveform(props: {
  level: number;
  active?: boolean;
  bars?: number;
  className?: string;
  label?: string;
}) {
  const bars = levelToBarPercents(props.active ? props.level : 0, props.bars ?? 7);
  return (
    <span
      className={`inline-flex h-8 items-end gap-0.5 ${props.className ?? ""}`}
      role="img"
      aria-label={props.label ?? (props.active ? "Voice level" : "Voice idle")}
      data-testid="voice-waveform"
      data-active={props.active ? "true" : "false"}
      data-level={props.level.toFixed(3)}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          className="w-1 rounded-sm bg-accent/80"
          style={{ height: `${height}%`, minHeight: 2, opacity: props.active ? 1 : 0.35 }}
        />
      ))}
    </span>
  );
}
