export const APPLE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export const APPLE_MOTION = {
  press: "180ms",
  control: "280ms",
  surface: "360ms",
  overlay: "420ms",
} as const;

export const APPLE_MOTION_STYLE_ID = "adrian-apple-motion";

const SAFE_PROPERTIES = "background-color, background, color, border-color, box-shadow, opacity, filter";

export function appleMotionCss() {
  const ease = APPLE_EASE;
  const control = `html[data-adrian-motion="apple"] :is(button, a, input, textarea, select, summary, [role="button"])`;
  const surface = `html[data-adrian-motion="apple"] :is(.settings-card, .settings-row, .gpt-rail, .rounded-panel)`;
  const overlay = `html[data-adrian-motion="apple"] :is([role="dialog"], .overlay-backdrop, .command-palette, .floating-menu)`;
  const layer = `html[data-adrian-motion="apple"] :is(.adrian-layer, .settings-card)`;
  const row = `html[data-adrian-motion="apple"] .adrian-row`;
  return `
${control} {
  transition-property: ${SAFE_PROPERTIES} !important;
  transition-duration: ${APPLE_MOTION.control} !important;
  transition-timing-function: ${ease} !important;
  transition-delay: 0s !important;
}
${control}:active {
  transition-duration: ${APPLE_MOTION.press} !important;
}
${surface} {
  transition-property: background-color, background, border-color, box-shadow, opacity !important;
  transition-duration: ${APPLE_MOTION.surface} !important;
  transition-timing-function: ${ease} !important;
}
${overlay} {
  transition-property: background-color, background, border-color, box-shadow, opacity !important;
  transition-duration: ${APPLE_MOTION.overlay} !important;
  transition-timing-function: ${ease} !important;
}
${layer} {
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.34), inset 0 1px 0 rgb(255 255 255 / 0.06) !important;
}
${row} {
  background: color-mix(in srgb, var(--color-surface) 76%, white) !important;
  box-shadow: 0 10px 22px rgb(0 0 0 / 0.28) !important;
}
${row}:active,
${row}[aria-pressed="true"] {
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.2) !important;
  opacity: 0.86;
}
@media (prefers-reduced-motion: reduce) {
  ${control},
  ${surface},
  ${overlay},
  ${row} {
    transition: none !important;
    animation: none !important;
  }
}
`.trim();
}

export function applyAppleMotion(doc: Document) {
  doc.documentElement.dataset.adrianMotion = "apple";
  writeMotionStyle(doc);
}

export function applyMotionChoice(doc: Document, choice: MotionChoice) {
  doc.documentElement.dataset.adrianMotion = choice === "reduce" ? "reduce" : "apple";
  writeMotionStyle(doc);
}

function writeMotionStyle(doc: Document) {
  let node = doc.getElementById(APPLE_MOTION_STYLE_ID);
  if (!node) {
    node = doc.createElement("style");
    node.id = APPLE_MOTION_STYLE_ID;
    doc.head.appendChild(node);
  }
  node.textContent = appleMotionCss();
}
export const MOTION_KEY = "amcos.motion.v1";
export type MotionChoice = "smooth" | "reduce";

export function readMotionChoice(raw: string | null, systemReduce = false): MotionChoice {
  if (raw === "smooth" || raw === "reduce") return raw;
  return systemReduce ? "reduce" : "smooth";
}
