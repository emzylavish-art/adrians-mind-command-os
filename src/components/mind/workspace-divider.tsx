import { useEffect, useRef, useState } from "react";

const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 208;
const MAX_WIDTH = 400;
const KEY = "adrian.navigation.sidebar-width";

function bounded(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

export function WorkspaceDivider({ collapsed }: { collapsed: boolean }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const handle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    } catch { /* Use the default width when storage is unavailable. */ }
  }, []);
  useEffect(() => {
    const sidebar = document.getElementById("workspace-sidebar");
    sidebar?.style.setProperty("--adrian-sidebar-width", width + "px");
  }, [width]);
  function save(next: number) {
    const value = bounded(next);
    setWidth(value);
    try { localStorage.setItem(KEY, String(value)); } catch { /* Resizing remains available in this window. */ }
  }
  function pointerWidth(x: number) {
    return x - (document.getElementById("workspace-sidebar")?.getBoundingClientRect().left ?? 0);
  }
  return <div ref={handle} hidden={collapsed} className="workspace-divider" role="separator" aria-label="Workspace sidebar width" aria-orientation="vertical" aria-controls="workspace-sidebar"
    aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuetext={width + " pixels"} tabIndex={0}
    onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(bounded(pointerWidth(event.clientX))); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { save(pointerWidth(event.clientX)); event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 8;
      const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: MIN_WIDTH, End: MAX_WIDTH }[event.key as "ArrowLeft" | "ArrowRight" | "Home" | "End"];
      if (next !== undefined) { event.preventDefault(); save(next); }
    }}
  />;
}
