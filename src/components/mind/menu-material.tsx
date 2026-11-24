import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export function MenuMotion() {
  return (
    <style>{`
      @keyframes adrian-menu-in {
        from { transform: translateY(8px) scale(0.96); }
        to { transform: none; }
      }
      @keyframes adrian-menu-out {
        from { opacity: 1; transform: none; }
        to { opacity: 0; transform: translateY(8px); }
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

export function finishMenu(node: HTMLElement | null, phase: "open" | "close" = "open") {
  if (!node) return;
  const light = document.documentElement.dataset.theme === "light";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.adrianMotion === "reduce";
  node.classList.add("adrian-menu");
  node.dataset.menuMaterial = "lifted";
  node.dataset.menuPhase = phase;
  if (phase !== "close") node.style.setProperty("opacity", "1", "important");
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
    node.style.setProperty("animation", "adrian-menu-in 180ms ease-out", "important");
  }
  if (!reduce && phase === "close") {
    node.style.setProperty("animation", "adrian-menu-out 150ms ease-in", "important");
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
        flex: wide ? "1 1 100%" : "1 1 auto",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.35rem",
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <p style={{ margin: 0, padding: "0.15rem 0.35rem", fontSize: "11px", fontWeight: 650, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.62 }}>{label}</p>
      {children}
    </section>
  );
}

/** Keep the menu in the browser's top layer so a scrolling composer cannot clip it. */
export function ComposerMore({ children, testId, onOpen }: { children: ReactNode; testId: string; onOpen?: () => void }) {
  const trigger = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = trigger.current;
    const menu = panel.current;
    if (!details || !menu) return;
    const position = () => {
      if (!menu.matches(":popover-open")) return;
      const summary = details.querySelector("summary")!;
      const anchor = summary.getBoundingClientRect();
      const viewport = window.visualViewport;
      const height = viewport?.height ?? innerHeight;
      const width = viewport?.width ?? innerWidth;
      const gap = 8;
      const panelWidth = Math.min(440, width - gap * 2);
      const above = anchor.top - gap * 2;
      const below = height - anchor.bottom - gap * 2;
      const opensAbove = above >= below;
      menu.style.setProperty("--menu-width", `${panelWidth}px`);
      menu.style.setProperty("--menu-left", `${Math.max(gap, Math.min(anchor.left, width - panelWidth - gap))}px`);
      menu.style.setProperty("--menu-height", `${Math.max(44, opensAbove ? above : below)}px`);
      menu.style.setProperty("--menu-top", `${opensAbove ? Math.max(gap, anchor.top - menu.offsetHeight - gap) : anchor.bottom + gap}px`);
    };
    const sync = () => {
      if (details.open) {
        if (!menu.matches(":popover-open")) menu.showPopover();
        position();
      } else if (menu.matches(":popover-open")) menu.hidePopover();
    };
    const closeOutside = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    details.addEventListener("toggle", sync);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      details.removeEventListener("toggle", sync);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, []);
  return <details ref={trigger} className="composer-more" onToggle={(event) => {
    if (event.target === event.currentTarget && event.currentTarget.open) onOpen?.();
  }} onKeyDown={(event) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary>More</summary>
    <div ref={panel} popover="manual" className="composer-more__menu" data-testid={testId}>{children}</div>
  </details>;
}

export function placeNear(card: HTMLElement, anchor: DOMRect, width = 320, align: "start" | "end" = "end") {
  const margin = 12;
  const w = Math.min(width, Math.max(0, window.innerWidth - margin * 2));
  card.style.setProperty("position", "fixed", "important");
  card.style.setProperty("width", `${w}px`, "important");
  card.style.setProperty("z-index", "1201", "important");
  card.style.setProperty("margin", "0", "important");
  const height = card.offsetHeight || 240;
  let top = anchor.bottom + 8;
  let left = align === "start" ? anchor.left : anchor.right - w;
  if (top + height > window.innerHeight - margin) top = anchor.top - height - 8;
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  if (left < margin) left = margin;
  if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
  card.style.setProperty("top", `${top}px`, "important");
  card.style.setProperty("left", `${left}px`, "important");
  card.style.setProperty("right", "auto", "important");
  card.style.setProperty("bottom", "auto", "important");
}

export function AnchoredCard({
  anchor,
  trigger,
  label,
  onClose,
  children,
  testId,
  width = 320,
  align = "end",
  catcher = true,
  phase = "open",
}: {
  anchor: DOMRect | null;
  trigger?: RefObject<HTMLButtonElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  width?: number;
  align?: "start" | "end";
  catcher?: boolean;
  phase?: "open" | "close";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    finishMenu(node, phase);
    const position = () => {
      const target = trigger?.current?.getBoundingClientRect() ?? anchor;
      if (target) placeNear(node, target, width, align);
    };
    position();
    const observer = trigger && typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    observer?.observe(node);
    if (trigger?.current) observer?.observe(trigger.current);
    if (trigger) window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      if (trigger) window.removeEventListener("resize", position);
    };
  }, [anchor, align, width, trigger, phase]);

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const opener = trigger?.current;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']"))
      .filter((item) => item.getClientRects().length > 0);
    if (opener) node.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (opener) event.preventDefault();
        close.current();
      } else if (event.key === "Tab" && opener && !event.defaultPrevented) {
        const items = focusables();
        const current = document.activeElement;
        const index = items.indexOf(current as HTMLElement);
        if (index === -1 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) ?? node : items[0] ?? node).focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [trigger]);
  if (typeof document === "undefined") return null;
  const light = document.documentElement.dataset.theme === "light";
  const card = (
    <div
      ref={panel}
      role="dialog"
      aria-modal={trigger ? true : false}
      tabIndex={trigger ? -1 : undefined}
      aria-label={label}
      id={testId}
      data-testid={testId}
      className="adrian-menu"
      data-menu-phase={phase}
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
