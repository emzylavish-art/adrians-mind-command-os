/**
 * Minimal baseline CSS for LiveVoiceBar / composer when Visual Polish styles.css
 * is deferred or missing. Injected once per document. Tailwind utilities remain
 * primary; these rules keep the bar on-screen and readable without VP.
 */
export const LIVE_VOICE_BASELINE_CSS = `
.composer-bar.is-fixed,
.live-voice-bar {
  position: fixed !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  box-sizing: border-box;
  pointer-events: auto;
}
.composer-bar.is-fixed[data-speak-only="true"] .composer-bar__ask,
.composer-bar.is-fixed[data-speak-only="true"] .composer-bar__left:not([aria-hidden]) {
  display: none !important;
}
.composer-bar__card,
.live-voice-bar > .relative {
  background: rgba(17, 17, 17, 0.98);
  color: #f4f4f5;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 1.75rem;
}
.composer-speak-pill,
.composer-speak-live {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  border-radius: 999px;
  background: #fff;
  color: #000;
  font-weight: 600;
  border: 0;
  cursor: pointer;
}
.composer-speak-pill[data-pressed="true"],
.composer-speak-live[data-pressed="true"],
.composer-speak-pill[aria-busy="true"] {
  background: #e4e4e7;
  opacity: 0.92;
}
.composer-voice-btns,
.composer-voice-row,
.live-voice-bar__controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.live-voice-bar__end,
.live-call-end {
  display: grid;
  place-items: center;
  min-height: 3rem;
  min-width: 5rem;
  border-radius: 999px;
  background: #f26b6b;
  color: #fff;
  border: 0;
  cursor: pointer;
}
.live-voice-bar [role="alert"],
.composer-bar [role="alert"] {
  color: #fca5a5;
  font-size: 0.75rem;
}
`;

let injected = false;

export function ensureLiveVoiceBaselineStyles(doc: Document | null | undefined = typeof document !== "undefined" ? document : null): boolean {
  if (!doc || injected) return injected;
  if (doc.getElementById("amcos-live-voice-baseline")) {
    injected = true;
    return true;
  }
  const style = doc.createElement("style");
  style.id = "amcos-live-voice-baseline";
  style.setAttribute("data-voice-wiring", "baseline");
  style.textContent = LIVE_VOICE_BASELINE_CSS;
  (doc.head || doc.documentElement).appendChild(style);
  injected = true;
  return true;
}

/** Test helper */
export function resetLiveVoiceBaselineStylesForTests(): void {
  injected = false;
  if (typeof document !== "undefined") {
    document.getElementById("amcos-live-voice-baseline")?.remove();
  }
}
