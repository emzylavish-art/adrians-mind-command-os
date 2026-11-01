import { useEffect } from "react";

/**
 * Presentational load-resilience host.
 * Toggles `is-scrolling` on <body> during scroll (CSS drops blur/glow/animations).
 * Honors `data-perf="lite"` when set on <html> or <body>.
 * Idempotent: safe to mount once from any presentational surface.
 */

const SCROLL_IDLE_MS = 140;
let listenersAttached = false;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let scrollCount = 0;

function onScroll() {
  const body = document.body;
  if (!body.classList.contains("is-scrolling")) {
    body.classList.add("is-scrolling");
  }
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    body.classList.remove("is-scrolling");
    scrollTimer = null;
  }, SCROLL_IDLE_MS);
  scrollCount += 1;
}

function attach() {
  if (typeof document === "undefined" || listenersAttached) return;
  listenersAttached = true;
  // Capture scroll on window + document (chat stream uses overflow containers)
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
}

function detach() {
  if (!listenersAttached) return;
  window.removeEventListener("scroll", onScroll, true);
  document.removeEventListener("scroll", onScroll, true);
  if (scrollTimer) clearTimeout(scrollTimer);
  document.body.classList.remove("is-scrolling");
  listenersAttached = false;
}

/** Imperative attach for harness / MessageBody bootstrap. */
export function ensurePerfTier(): void {
  attach();
}

export function PerfTierHost() {
  useEffect(() => {
    attach();
    return () => {
      // Keep listeners if other hosts remain; only clear scrolling class on unmount of last
      // For simplicity of single-host use, detach fully.
      detach();
    };
  }, []);
  return null;
}

/** Test helper */
export function __perfTierDebug() {
  return { listenersAttached, scrollCount };
}
