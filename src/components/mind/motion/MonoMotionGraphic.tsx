/**
 * Safe mono motion graphic — HyperFrames alternative for in-app UI.
 *
 * HyperFrames (heygen-com/hyperframes, Apache 2.0) is a Node/Chrome/FFmpeg
 * HTML→MP4 pipeline; it is not installed here (see
 * /workspace/audit/mind-os/hyperframes-license.md). This CSS/WAAPI pulse is
 * lazy-friendly, SSR-safe (no window at import), monochrome, and gated by
 * VITE_FEATURE_MONO_MOTION=1. Honors prefers-reduced-motion.
 */
import { useEffect, useState } from "react";
import { isMonoMotionEnabled } from "./mono-motion-gate.ts";

function prefersReduced(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

export type MonoMotionGraphicProps = {
  /** Visible label for assistive tech; decorative by default. */
  label?: string;
  className?: string;
  /** Force-enable without env (tests). */
  force?: boolean;
};

/**
 * Tiny monochrome breathing ring. Returns null when flag off or reduced-motion.
 * Keep off the critical path — import via React.lazy or mount only under the flag.
 */
export function MonoMotionGraphic({ label = "Motion accent", className = "", force = false }: MonoMotionGraphicProps) {
  const [alive, setAlive] = useState(false);

  useEffect(() => {
    if (!force && !isMonoMotionEnabled()) {
      setAlive(false);
      return;
    }
    setAlive(!prefersReduced());
  }, [force]);

  if (!alive) return null;

  return (
    <span
      className={`mono-motion-graphic ${className}`.trim()}
      role="img"
      aria-label={label}
      data-testid="mono-motion-graphic"
    >
      <span className="mono-motion-graphic__ring" aria-hidden="true" />
      <span className="mono-motion-graphic__core" aria-hidden="true" />
    </span>
  );
}

export default MonoMotionGraphic;
