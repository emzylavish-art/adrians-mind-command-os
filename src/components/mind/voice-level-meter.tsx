import { levelToBarPercents, meterValue } from "@/lib/mind/voice/level";

/** Live mic input meter (AnalyserNode RMS → bars). Flat when not listening. */
export function VoiceLevelMeter(props: {
  level: number;
  listening: boolean;
  bars?: number;
  className?: string;
}) {
  const value = meterValue(props.listening, props.level);
  const heights = levelToBarPercents(value, props.bars ?? 5);
  const percent = Math.round(value * 100);
  return (
    <span
      className={`inline-flex h-7 items-end gap-0.5 ${props.className ?? ""}`}
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-testid="voice-level-meter"
      data-listening={props.listening ? "true" : "false"}
    >
      {heights.map((height, index) => (
        <span
          key={index}
          className="w-1 rounded-sm bg-accent/80"
          style={{ height: `${height}%`, minHeight: 2, opacity: props.listening ? 1 : 0.35 }}
        />
      ))}
    </span>
  );
}
