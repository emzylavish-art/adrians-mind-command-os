import { useEffect, useMemo, useState } from "react";
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

export function GraphFiltersPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTER);
  const lanes = useMemo(() => laneOptions(), []);

  useEffect(() => {
    dispatchGraphFilter(filter);
  }, [filter]);

  return (
    <aside className="dash3d-graph-filters dash3d-glass" data-testid="graph-filters" aria-label="Constellation filters">
      <div className="dash3d-feed-head">
        <h2>Filters</h2>
        <button
          type="button"
          className="dash3d-pill"
          data-testid="graph-filters-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Groups"}
        </button>
      </div>
      {open ? (
        <div className="dash3d-graph-filters-body" data-testid="graph-filters-body">
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
      ) : (
        <p className="dash3d-muted" style={{ fontSize: "0.68rem", margin: 0 }}>
          Search · health · lane · orphans
        </p>
      )}
    </aside>
  );
}
