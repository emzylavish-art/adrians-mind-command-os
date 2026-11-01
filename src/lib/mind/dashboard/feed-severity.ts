/**
 * Queue #19 — Feed severity from real event text only (never invents status).
 * Pulse faster when Merge Gate / lock notes mention blocked/main.
 */
import type { FeedKind } from "./sky-feed.ts";

export type FeedSeverity = "calm" | "alert";

const ALERT_RE = /\b(blocked|blocking|blockers?|main\b|do not merge|force.?push|halted|halt\b)/i;

export function feedSeverity(kind: FeedKind | string, text: string): FeedSeverity {
  const k = String(kind || "");
  const t = String(text || "");
  if (k === "merge_gate" || k === "lock" || k === "gap") {
    if (ALERT_RE.test(t)) return "alert";
  }
  if (ALERT_RE.test(t) && (k === "conductor" || k === "landing")) return "alert";
  return "calm";
}

/** Opacity pulse frequency multiplier (1 = normal, 2.2 = alert). */
export function feedPulseSpeedMul(severity: FeedSeverity): number {
  return severity === "alert" ? 2.2 : 1;
}
