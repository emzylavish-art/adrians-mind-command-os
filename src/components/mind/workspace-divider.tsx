import { useEffect, useRef, useState } from "react";

const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 208;
const MAX_WIDTH = 400;
const KEY = "adrian.navigation.sidebar-width";

function viewportLimit() {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(window.innerWidth * .42)));
}

export function WorkspaceDivider({ collapsed }: { collapsed: boolean }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [limit, setLimit] = useState(MAX_WIDTH);
  const drag = useRef<{ startX: number; startWidth: number; previousWidth: number } | null>(null);
  const appliedWidth = Math.min(width, limit);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    } catch { /* Use the default width when storage is unavailable. */ }
    const syncLimit = () => setLimit(viewportLimit());
    syncLimit();
    window.addEventListener("resize", syncLimit);
    return () => window.removeEventListener("resize", syncLimit);
  }, []);
  useEffect(() => {
    const sidebar = document.getElementById("workspace-sidebar");
    sidebar?.style.setProperty("--adrian-sidebar-width", appliedWidth + "px");
  }, [appliedWidth]);
  function bounded(next: number) {
    return Math.max(MIN_WIDTH, Math.min(limit, Math.round(next)));
  }
  function save(next: number) {
    const value = bounded(next);
    setWidth(value);
    try { localStorage.setItem(KEY, String(value)); } catch { /* Resizing remains available in this window. */ }
  }
  function cancelDrag() {
    if (drag.current) setWidth(drag.current.previousWidth);
    drag.current = null;
  }
  return <div hidden={collapsed} className="workspace-divider" role="separator" aria-label="Workspace sidebar width" aria-orientation="vertical" aria-controls="workspace-sidebar"
    aria-valuenow={appliedWidth} aria-valuemin={MIN_WIDTH} aria-valuemax={limit} aria-valuetext={appliedWidth + " pixels"} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      drag.current = { startX: event.clientX, startWidth: appliedWidth, previousWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
    }}
    onPointerMove={event => {
      if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
        setWidth(bounded(drag.current.startWidth + event.clientX - drag.current.startX));
      }
    }}
    onPointerUp={event => {
      if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
        if (event.clientX !== drag.current.startX) save(drag.current.startWidth + event.clientX - drag.current.startX);
        else setWidth(drag.current.previousWidth);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }}
    onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) cancelDrag(); }}
    onLostPointerCapture={cancelDrag}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 8;
      const next = { ArrowLeft: appliedWidth - step, ArrowRight: appliedWidth + step, Home: MIN_WIDTH, End: limit }[event.key as "ArrowLeft" | "ArrowRight" | "Home" | "End"];
      if (next !== undefined) { event.preventDefault(); save(next); }
    }}
  />;
}
