import { useEffect, useState } from "react";
import { shortcutGroupsForSheet, type ShortcutGroup } from "@/components/mind/shortcuts-catalog";
import { finishMenu, MenuMotion } from "@/components/mind/menu-material";

export function ShortcutSheet(props: {
  open: boolean;
  onClose: () => void;
  hostMounted?: boolean;
  groups?: ShortcutGroup[];
}) {
  if (!props.open) return null;
  const groups = props.groups ?? shortcutGroupsForSheet({ hostMounted: Boolean(props.hostMounted) });

  return (
    <div
      className="shortcut-sheet-shell"
      data-testid="shortcut-sheet"
      role="dialog"
      aria-modal="false"
      aria-label="Keyboard shortcuts"
      ref={(node) => {
        node?.style.setProperty("position", "fixed", "important");
        node?.style.setProperty("inset", "0", "important");
        node?.style.setProperty("z-index", "80", "important");
        node?.style.setProperty("background", "transparent", "important");
        node?.style.setProperty("backdrop-filter", "none", "important");
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <MenuMotion />
      <div className="shortcut-sheet-panel" ref={finishMenu} style={{ position: "fixed", top: 72, right: 16, width: "min(24rem, calc(100vw - 24px))" }}>
        <header className="shortcut-sheet-header">
          <div>
            <p className="shortcut-sheet-kicker">Keyboard</p>
            <h2 className="shortcut-sheet-title">Shortcuts</h2>
            <p className="shortcut-sheet-lead">Only bindings that exist in this build. No decorative fakes.</p>
          </div>
          <button type="button" className="shortcut-sheet-close focus-ring" onClick={props.onClose} aria-label="Close shortcuts" data-testid="shortcut-sheet-close">
            Esc
          </button>
        </header>
        <div className="shortcut-sheet-grid">
          {groups.map((group) => (
            <section key={group.id} className="shortcut-sheet-group" data-group={group.id}>
              <h3>{group.label}</h3>
              {group.entries.length === 0 ? (
                <p className="shortcut-sheet-empty">{group.emptyNote ?? "None"}</p>
              ) : (
                <ul>
                  {group.entries.map((entry) => (
                    <li key={`${group.id}-${entry.keys}-${entry.action}`}>
                      <kbd>{entry.keys}</kbd>
                      <span>
                        <span className="shortcut-sheet-action">{entry.action}</span>
                        <span className="shortcut-sheet-source">{entry.source}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Self-contained host: registers ? and Ctrl/Cmd+/ and Esc for the sheet.
 * Mount with a single line: `<ShortcutSheetHost />`
 * Also listens for `mind:open-shortcut-sheet` CustomEvent (palette action).
 */
export function ShortcutSheetHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return Boolean(el.closest("[contenteditable=true]"));
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };

    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mind:open-shortcut-sheet", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mind:open-shortcut-sheet", onOpen as EventListener);
    };
  }, [open]);

  return <ShortcutSheet open={open} onClose={() => setOpen(false)} hostMounted />;
}

export function openShortcutSheet() {
  window.dispatchEvent(new Event("mind:open-shortcut-sheet"));
}
