import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

export type MobilePanelId =
  | "scene"
  | "weather"
  | "notion"
  | "money"
  | "fleet"
  | "forever"
  | "time"
  | "feed"
  | "charts"
  | "mirror"
  | "compass"
  | "flyhud";

export const MOBILE_SECTIONS: Array<{ id: MobilePanelId; label: string; hash: string }> = [
  { id: "scene", label: "Scene", hash: "panel-scene" },
  { id: "notion", label: "Notion", hash: "panel-notion" },
  { id: "money", label: "Money", hash: "panel-money" },
  { id: "feed", label: "Feed", hash: "panel-feed" },
  { id: "charts", label: "Charts", hash: "panel-charts" },
  { id: "mirror", label: "Mirror", hash: "panel-mirror" },
  { id: "compass", label: "Compass", hash: "panel-compass" },
];

type CardProps = {
  id: MobilePanelId;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  focused: MobilePanelId | null;
  onFocus: (id: MobilePanelId | null) => void;
  summary?: string;
  testId?: string;
};

/**
 * Mobile: collapsible card in a single scroll column.
 * Desktop: wrapper uses display:contents so absolute panel CSS stays intact.
 */
export function MobilePanelCard({
  id,
  title,
  children,
  defaultOpen = false,
  focused,
  onFocus,
  summary,
  testId,
}: CardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const isFocused = focused === id;
  const expanded = open || isFocused;

  useEffect(() => {
    if (isFocused) setOpen(true);
  }, [isFocused]);

  return (
    <section
      id={`panel-${id}`}
      className={`dash3d-mobile-card${expanded ? " is-open" : " is-collapsed"}${isFocused ? " is-focused" : ""}`}
      data-testid={testId ?? `mobile-card-${id}`}
      data-panel-id={id}
      data-focused={isFocused ? "1" : "0"}
      data-open={expanded ? "1" : "0"}
    >
      <div className="dash3d-mobile-card-head">
        <button
          type="button"
          className="dash3d-mobile-card-toggle"
          data-testid={`mobile-card-toggle-${id}`}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => {
            if (isFocused) return;
            setOpen((v) => !v);
          }}
        >
          <span className="dash3d-mobile-card-title">{title}</span>
          {summary && !expanded ? (
            <span className="dash3d-muted dash3d-mobile-card-summary">{summary}</span>
          ) : null}
          <span className="dash3d-mobile-card-chevron" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        <div className="dash3d-mobile-card-actions">
          {!isFocused ? (
            <button
              type="button"
              className="dash3d-pill"
              data-testid={`mobile-card-focus-${id}`}
              onClick={() => {
                setOpen(true);
                onFocus(id);
              }}
            >
              Open
            </button>
          ) : (
            <button
              type="button"
              className="dash3d-pill"
              data-testid={`mobile-card-back-${id}`}
              onClick={() => onFocus(null)}
            >
              Back
            </button>
          )}
        </div>
      </div>
      <div id={bodyId} className="dash3d-mobile-card-body" data-testid={`mobile-card-body-${id}`}>
        {children}
      </div>
    </section>
  );
}

type NavProps = {
  focused: MobilePanelId | null;
  onJump: (id: MobilePanelId) => void;
};

export function MobileSectionNav({ focused, onJump }: NavProps) {
  return (
    <nav className="dash3d-mobile-nav" data-testid="mobile-section-nav" aria-label="Dashboard sections">
      {MOBILE_SECTIONS.map((s) => (
        <a
          key={s.id}
          className={`dash3d-mobile-nav-link${focused === s.id ? " is-active" : ""}`}
          href={`#${s.hash}`}
          data-testid={`mobile-nav-${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            onJump(s.id);
            const el = document.getElementById(s.hash);
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export function MobileChrome({
  sceneInteract,
  onSceneInteract,
  filtersSlot,
  focused,
  onJump,
  onBack,
}: {
  sceneInteract: boolean;
  onSceneInteract: (v: boolean) => void;
  filtersSlot: ReactNode;
  focused: MobilePanelId | null;
  onJump: (id: MobilePanelId) => void;
  onBack: () => void;
}) {
  return (
    <div className="dash3d-mobile-chrome" data-testid="mobile-chrome">
      {focused ? (
        <button type="button" className="dash3d-pill dash3d-mobile-back" data-testid="mobile-panel-back" onClick={onBack}>
          ← Back
        </button>
      ) : null}
      <MobileSectionNav focused={focused} onJump={onJump} />
      <div className="dash3d-mobile-chrome-row">
        <button
          type="button"
          className={`dash3d-pill${sceneInteract ? " is-on" : ""}`}
          data-testid="scene-interact-toggle"
          aria-pressed={sceneInteract}
          title="When on, one-finger pan/pinch the 3D graph; when off, vertical swipe scrolls the page"
          onClick={() => onSceneInteract(!sceneInteract)}
        >
          {sceneInteract ? "Scene: interact" : "Scene: scroll"}
        </button>
        {filtersSlot}
      </div>
    </div>
  );
}

export function useMobilePanelFocus() {
  const [focused, setFocused] = useState<MobilePanelId | null>(null);
  const clear = useCallback(() => setFocused(null), []);
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);
  return { focused, setFocused, clear };
}
