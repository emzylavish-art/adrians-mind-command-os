import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function MenuMotion() {
  return (
    <style>{`
      @keyframes adrian-menu-in {
        from { transform: translateY(8px) scale(0.96); }
        to { transform: none; }
      }
      @keyframes adrian-drawer-in {
        from { opacity: 0.72; transform: translateX(-16px); }
        to { opacity: 1; transform: none; }
      }
      .adrian-menu button:hover,
      .adrian-menu [role="menuitem"]:hover,
      .adrian-menu [role="option"]:hover,
      .adrian-menu a:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      html[data-theme="light"] .adrian-menu button:hover,
      html[data-theme="light"] .adrian-menu [role="menuitem"]:hover,
      html[data-theme="light"] .adrian-menu [role="option"]:hover,
      html[data-theme="light"] .adrian-menu a:hover {
        background: rgba(0, 0, 0, 0.06);
      }
    `}</style>
  );
}

export function finishMenu(node: HTMLElement | null) {
  if (!node) return;
  const light = document.documentElement.dataset.theme === "light";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.adrianMotion === "reduce";
  node.classList.add("adrian-menu");
  node.dataset.menuMaterial = "lifted";
  node.style.setProperty("opacity", "1", "important");
  node.style.setProperty("background-color", light ? "#f4f4f5" : "#1c1c1e", "important");
  node.style.setProperty("background-image", "none", "important");
  node.style.setProperty("backdrop-filter", "none", "important");
  node.style.setProperty("-webkit-backdrop-filter", "none", "important");
  node.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
  node.style.setProperty("border", light ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.12)", "important");
  node.style.setProperty("border-radius", "22px", "important");
  node.style.setProperty("box-shadow", light ? "inset 0 1px 0 #fff, 0 24px 60px rgba(15, 23, 42, 0.18)" : "inset 0 1px 0 rgba(255,255,255,0.14), 0 28px 70px rgba(0,0,0,0.55)", "important");
  node.style.setProperty("overflow", "auto", "important");
  node.style.setProperty("max-height", "min(70vh, 32rem)", "important");
  node.style.setProperty("padding", "8px", "important");
  if (!reduce && node.dataset.menuAnimated !== "1") {
    node.dataset.menuAnimated = "1";
    node.style.setProperty("animation", "adrian-menu-in 220ms cubic-bezier(0.22, 1, 0.36, 1)", "important");
  }
}

export function MenuGroup({ label, first = false, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div>
      {first ? null : <div className="mx-3 my-1 border-t border-line" data-testid="menu-line" />}
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      {children}
    </div>
  );
}

export const menuChip: CSSProperties = {
  display: "inline-flex",
  flex: "1 1 7.5rem",
  alignItems: "center",
  gap: "0.4rem",
  width: "auto",
  maxWidth: "100%",
  minWidth: "6.5rem",
  minHeight: "2.75rem",
};

export function pinShelf(node: HTMLElement | null, width = "min(36rem, calc(100vw - 1.25rem))", bound = true) {
  if (!node) return;
  node.dataset.menuShelf = "1";
  node.style.setProperty("display", "flex", "important");
  node.style.setProperty("flex-direction", "row", "important");
  node.style.setProperty("flex-wrap", "wrap", "important");
  node.style.setProperty("align-items", "flex-start", "important");
  node.style.setProperty("align-content", "flex-start", "important");
  node.style.setProperty("gap", "0.65rem", "important");
  node.style.setProperty("width", width, "important");
  node.style.setProperty("max-width", width, "important");
  node.style.setProperty("min-width", "0", "important");
  node.style.setProperty("box-sizing", "border-box", "important");
  if (bound) {
    node.style.setProperty("max-height", "min(70vh, 32rem)", "important");
    node.style.setProperty("overflow", "auto", "important");
  }
  requestAnimationFrame(() => {
    const box = node.getBoundingClientRect();
    if (box.width < 8) return;
    const margin = 8;
    if (box.right > window.innerWidth - margin) {
      const next = Math.max(180, Math.floor(window.innerWidth - margin - Math.max(box.left, margin)));
      node.style.setProperty("width", `${next}px`, "important");
      node.style.setProperty("max-width", `${next}px`, "important");
    }
  });
}

export function MenuShelf({
  children,
  width = "100%",
  bound = false,
  testId = "menu-shelf",
}: {
  children: ReactNode;
  width?: string;
  bound?: boolean;
  testId?: string;
}) {
  return (
    <div ref={(node) => pinShelf(node, width, bound)} data-testid={testId}>
      {children}
    </div>
  );
}

export function MenuCluster({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      data-menu-cluster={label}
      style={{
        display: "flex",
        flex: wide ? "1 1 18rem" : "1 1 16rem",
        flexDirection: "column",
        gap: "0.35rem",
        minWidth: "min(100%, 15rem)",
        maxWidth: "100%",
      }}
    >
      <p style={{ margin: 0, padding: "0.1rem 0.15rem 0", fontSize: "11px", fontWeight: 650, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.62 }}>{label}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", minWidth: 0, maxWidth: "100%" }}>{children}</div>
    </section>
  );
}

export function placeNear(card: HTMLElement, anchor: DOMRect, width = 320, align: "start" | "end" = "end") {
  const margin = 12;
  const w = Math.min(width, window.innerWidth - margin * 2);
  card.style.setProperty("position", "fixed", "important");
  card.style.setProperty("width", `${w}px`, "important");
  card.style.setProperty("z-index", "1201", "important");
  card.style.setProperty("margin", "0", "important");
  const height = card.getBoundingClientRect().height || 240;
  let top = anchor.bottom + 8;
  let left = align === "start" ? anchor.left : anchor.right - w;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - 8);
  if (left < margin) left = margin;
  if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
  card.style.setProperty("top", `${top}px`, "important");
  card.style.setProperty("left", `${left}px`, "important");
  card.style.setProperty("right", "auto", "important");
  card.style.setProperty("bottom", "auto", "important");
}

export function AnchoredCard({
  anchor,
  label,
  onClose,
  children,
  testId,
  width = 320,
  align = "end",
  catcher = true,
}: {
  anchor: DOMRect | null;
  label: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  width?: number;
  align?: "start" | "end";
  catcher?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    finishMenu(node);
    if (anchor) placeNear(node, anchor, width, align);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anchor, align, onClose, width, children]);
  if (typeof document === "undefined") return null;
  const light = document.documentElement.dataset.theme === "light";
  const card = (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      id={testId}
      data-testid={testId}
      className="adrian-menu"
      style={{
        position: "fixed",
        zIndex: 1201,
        width: `min(${width}px, calc(100vw - 24px))`,
        maxWidth: "calc(100vw - 24px)",
        backgroundColor: light ? "#f4f4f5" : "#1c1c1e",
        color: light ? "#18181b" : "#fafafa",
        border: light ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.12)",
        borderRadius: 22,
        boxShadow: light ? "0 24px 60px rgba(15, 23, 42, 0.18)" : "0 28px 70px rgba(0,0,0,0.55)",
        overflow: "auto",
        maxHeight: "min(70vh, 32rem)",
        padding: 8,
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
  return createPortal(
    catcher ? (
      <div className="fixed inset-0" style={{ zIndex: 1200, background: "transparent" }} onMouseDown={onClose}>
        <MenuMotion />
        {card}
      </div>
    ) : (
      <>
        <MenuMotion />
        {card}
      </>
    ),
    document.body,
  );
}
