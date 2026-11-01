import { useEffect, useMemo, useState } from "react";
import { Pin } from "lucide-react";
import type { PaletteHit } from "@/lib/mind/palette";

type PinKind = "chat" | "agent" | "project" | "file";

/**
 * Presentational Cmd/Ctrl+K results panel — grouped, empty state, arrow/Enter/Esc.
 * Does not change paletteHits / destination logic; parent supplies hits + onSelect.
 */
export function CommandPalettePanel(props: {
  open: boolean;
  query: string;
  hits: PaletteHit[];
  onSelect: (hit: PaletteHit) => void;
  onClose: () => void;
  onPin?: (kind: PinKind, ref: string) => void;
  onOpenShortcuts?: () => void;
}) {
  const [active, setActive] = useState(0);

  const groups = useMemo(() => {
    const order = ["Go to", "Chat", "Agent", "Project", "Run", "Note", "File", "Other"];
    const map = new Map<string, PaletteHit[]>();
    for (const hit of props.hits) {
      const key = hit.meta.startsWith("Run") ? "Run" : hit.meta || "Other";
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    // Synthetic shortcuts row when query matches
    const q = props.query.trim().toLowerCase();
    const showShortcuts =
      !q || "keyboard".includes(q) || "shortcut".includes(q) || "shortcuts".includes(q) || q === "?";
    const rows: { label: string; hits: PaletteHit[] }[] = [];
    if (showShortcuts && props.onOpenShortcuts) {
      rows.push({
        label: "Help",
        hits: [
          {
            key: "help-shortcuts",
            label: "Keyboard shortcuts",
            meta: "Help",
            view: "help",
            ref: "",
          },
        ],
      });
    }
    for (const label of order) {
      const hits = map.get(label);
      if (hits?.length) rows.push({ label, hits });
    }
    for (const [label, hits] of map) {
      if (!order.includes(label) && label !== "Help") rows.push({ label, hits });
    }
    return rows;
  }, [props.hits, props.query, props.onOpenShortcuts]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => {
    setActive(0);
  }, [props.query, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter" && flat[active]) {
        event.preventDefault();
        const hit = flat[active];
        if (hit.key === "help-shortcuts") {
          props.onOpenShortcuts?.();
          props.onClose();
          return;
        }
        props.onSelect(hit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, flat, active, props]);

  if (!props.open) return null;

  return (
    <div id="command-palette" className="command-palette-panel floating-menu absolute z-30 mt-2 max-h-80 w-full overflow-auto p-2" role="listbox" aria-label="Command palette" data-testid="command-palette">
      {flat.length === 0 ? (
        <div className="command-palette-empty" data-testid="command-palette-empty">
          <p className="font-semibold">No matches</p>
          <p className="text-xs text-muted">Try a page name, chat title, or “shortcuts”.</p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="command-palette-group">
            <p className="command-palette-group-label">{group.label}</p>
            {group.hits.map((hit) => {
              const index = flat.findIndex((row) => row.key === hit.key);
              const selected = index === active;
              const kind: PinKind | null =
                hit.meta === "Chat" ? "chat" : hit.meta === "Agent" ? "agent" : hit.meta === "Project" ? "project" : hit.meta === "File" ? "file" : null;
              return (
                <div key={hit.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`command-palette-item focus-ring flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-panel px-2 text-left text-sm ${selected ? "command-palette-item-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      if (hit.key === "help-shortcuts") {
                        props.onOpenShortcuts?.();
                        props.onClose();
                        return;
                      }
                      props.onSelect(hit);
                    }}
                  >
                    <span className="truncate">{hit.label}</span>
                    <span className="text-xs text-muted">{hit.meta}</span>
                  </button>
                  {kind && hit.ref && props.onPin ? (
                    <button
                      type="button"
                      className="grid size-11 shrink-0 place-items-center rounded-panel text-muted focus-ring"
                      aria-label={`Pin ${hit.label}`}
                      onClick={() => props.onPin?.(kind, hit.ref)}
                    >
                      <Pin className="size-4" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
