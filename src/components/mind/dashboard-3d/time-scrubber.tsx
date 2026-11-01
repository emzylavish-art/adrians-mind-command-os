import { useMemo } from "react";
import type { Timeline } from "@/lib/mind/dashboard/time-scrub";
import { formatWat, scrubMsFromRatio } from "@/lib/mind/dashboard/time-scrub";

type Props = {
  timeline: Timeline;
  /** null = Live */
  scrubMs: number | null;
  nowMs: number;
  message: string | null;
  mode: "live" | "scrub" | "before_history";
  onScrubMs: (ms: number | null) => void;
};

export function TimeScrubber({ timeline, scrubMs, nowMs, message, mode, onScrubMs }: Props) {
  const earliest = timeline.earliestMs;
  const latest = Math.min(timeline.latestMs ?? nowMs, nowMs);
  const span = earliest != null ? Math.max(1, latest - earliest) : 1;
  const value =
    scrubMs == null || earliest == null
      ? 1
      : Math.min(1, Math.max(0, (Math.min(scrubMs, latest) - earliest) / span));

  const label = useMemo(() => {
    if (mode === "live" || scrubMs == null) return "Live";
    return formatWat(scrubMs);
  }, [mode, scrubMs]);

  const eventHint = useMemo(() => {
    if (!timeline.events.length) return "No git/lock history on box yet.";
    const n = timeline.events.length;
    const extra = timeline.truncated ? " (truncated)" : "";
    return `${n} events${extra} · commits + lock claim/release/heartbeat`;
  }, [timeline]);

  return (
    <div className="dash3d-glass dash3d-time-scrub" data-testid="time-scrubber" data-mode={mode}>
      <div className="dash3d-time-scrub-head">
        <h2>Time</h2>
        <button
          type="button"
          className="dash3d-time-live"
          data-testid="time-live"
          aria-pressed={mode === "live"}
          onClick={() => onScrubMs(null)}
        >
          Live
        </button>
      </div>
      <p className="dash3d-title" data-testid="time-scrub-label">
        {label}
      </p>
      <input
        type="range"
        className="dash3d-time-range"
        data-testid="time-scrub-range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(value * 1000)}
        aria-label="Timeline scrubber"
        aria-valuetext={label}
        disabled={!timeline.events.length}
        onChange={(e) => {
          const ratio = Number(e.target.value) / 1000;
          if (ratio >= 0.995) {
            onScrubMs(null);
            return;
          }
          const ms = scrubMsFromRatio(timeline, ratio, nowMs);
          onScrubMs(ms);
        }}
      />
      <p className="dash3d-muted" style={{ fontSize: "0.68rem" }}>
        {message ? message : eventHint}
      </p>
      {earliest != null ? (
        <p className="dash3d-muted" style={{ fontSize: "0.62rem" }}>
          from {formatWat(earliest)}
        </p>
      ) : null}
    </div>
  );
}
