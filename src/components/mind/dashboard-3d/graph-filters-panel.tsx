import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Health } from "@/lib/mind/dashboard/types";
import {
  DEFAULT_GRAPH_FILTER,
  laneOptions,
  type GraphFilterState,
} from "@/lib/mind/dashboard/graph-filters";

const HEALTHS: Array<Health | "all"> = ["all", "healthy", "stalled", "blocked", "idle"];

export function dispatchGraphFilter(filter: GraphFilterState) {
  document.dispatchEvent(new CustomEvent("dash3d-graph-filter", { detail: filter }));
}

type Props = {
  /** When true, render only the trigger (for mobile chrome). Body is portaled as sheet. */
  triggerOnly?: boolean;
  filter?: GraphFilterState;
  onFilterChange?: (filter: GraphFilterState) => void;
};

export function GraphFiltersPanel({ triggerOnly = false, filter: controlledFilter, onFilterChange }: Props) {
  const [open, setOpen] = useState(false);
  const [localFilter, setLocalFilter] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTER);
  const filter = controlledFilter ?? localFilter;
  const bodyId = useId();
  const setFilter = (next: GraphFilterState | ((current: GraphFilterState) => GraphFilterState)) => {
    const value = typeof next === "function" ? next(filter) : next;
    if (onFilterChange) onFilterChange(value);
    else setLocalFilter(value);
  };
  const lanes = useMemo(() => laneOptions(), []);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!onFilterChange) dispatchGraphFilter(filter);
  }, [filter, onFilterChange]);

  // Closed by default; Esc + outside tap close the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (sheetRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // capture so we beat panel handlers; slight defer avoids closing on the opening click
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  const body = (
    <div
      className="dash3d-graph-filters-body"
      data-testid="graph-filters-body"
      id={bodyId}
    >
      <label className="dash3d-muted" style={{ fontSize: "0.68rem", display: "block" }}>
        Search
        <input
          className="dash3d-input"
          data-testid="graph-filter-search"
          value={filter.query}
          placeholder="name / id / branch"
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
      </label>
      <div className="dash3d-flyhud-row" style={{ flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
        {HEALTHS.map((h) => (
          <button
            key={h}
            type="button"
            className={`dash3d-pill${filter.health === h ? " is-on" : ""}`}
            data-testid={`graph-filter-health-${h}`}
            aria-pressed={filter.health === h}
            onClick={() => setFilter((f) => ({ ...f, health: h }))}
          >
            {h}
          </button>
        ))}
      </div>
      <label className="dash3d-muted" style={{ fontSize: "0.68rem", display: "block", marginTop: "0.45rem" }}>
        Lane group
        <select
          className="dash3d-input"
          data-testid="graph-filter-lane"
          value={filter.lane}
          onChange={(e) => setFilter((f) => ({ ...f, lane: e.target.value as GraphFilterState["lane"] }))}
        >
          {lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginTop: "0.5rem", fontSize: "0.72rem" }}>
        <input
          type="checkbox"
          data-testid="graph-filter-orphans"
          checked={filter.orphansOnly}
          onChange={(e) => setFilter((f) => ({ ...f, orphansOnly: e.target.checked }))}
        />
        Orphans only (no constellation edge)
      </label>
      <button
        type="button"
        className="dash3d-pill"
        data-testid="graph-filter-reset"
        style={{ marginTop: "0.45rem" }}
        onClick={() => setFilter(DEFAULT_GRAPH_FILTER)}
      >
        Reset filters
      </button>
    </div>
  );

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="dash3d-pill"
      data-testid="graph-filters-toggle"
     aria-expanded={open}
     aria-controls={bodyId}
      title="Search, health, lane, and orphans"
     onClick={() => setOpen((o) => !o)}
   >
      {open ? "Close filters" : "Filters"}
    </button>
  );

  // Desktop aside + sheet overlay when open. Mobile chrome can pass triggerOnly.
  return (
    <>
      {!triggerOnly ? (
        <span className="dash3d-graph-filters-trigger-slot" data-testid="graph-filters">
          {trigger}
        </span>
      ) : (
        <span className="dash3d-graph-filters-trigger-slot" data-testid="graph-filters-trigger-slot">
          {trigger}
        </span>
      )}
      {open ? (
        <div
          className="dash3d-filter-sheet-root"
          data-testid="graph-filters-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Constellation filters"
        >
          <div className="dash3d-filter-sheet-backdrop" data-testid="graph-filters-backdrop" />
          <div ref={sheetRef} className="dash3d-filter-sheet dash3d-glass">
            <div className="dash3d-feed-head">
              <h2>Filters</h2>
              <button
                type="button"
                className="dash3d-pill"
                data-testid="graph-filters-sheet-close"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {body}
          </div>
        </div>
      ) : null}
    </>
  );
}
