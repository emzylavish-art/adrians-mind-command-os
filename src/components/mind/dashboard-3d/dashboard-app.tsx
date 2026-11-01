import { useMemo, useState } from "react";
import type { BotNode } from "@/lib/mind/dashboard/types";
import { GlassHud } from "./glass-hud";
import { NodeDetailPanel } from "./node-detail-panel";
import { NodeGraph } from "./node-graph";
import { useDashboardStatus } from "./use-dashboard-status";
import "./dashboard-3d.css";

export function DashboardApp() {
  const { state } = useDashboardStatus();
  const [selected, setSelected] = useState<BotNode | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  return (
    <main className="dash3d-root">
      {state.status === "ready" && !webglError ? (
        <NodeGraph
          bots={state.data.bots}
          reducedMotion={reducedMotion}
          onSelect={(bot) => setSelected(bot)}
          onUnavailable={setWebglError}
        />
      ) : null}

      {webglError ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass" style={{ maxWidth: 420 }}>
            <h2>3D graph unavailable</h2>
            <p className="dash3d-title">WebGL fallback</p>
            <p className="dash3d-muted">{webglError}</p>
            {state.status === "ready" ? (
              <ul className="dash3d-list" style={{ marginTop: "0.75rem", textAlign: "left" }}>
                {state.data.bots.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="dash3d-pill"
                      onClick={() => setSelected(b)}
                      style={{ cursor: "pointer" }}
                    >
                      <span className={`dash3d-dot ${b.health}`} />
                      {b.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Dashboard</h2>
            <p className="dash3d-title">Loading live status…</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Status error</h2>
            <p className="dash3d-title">Could not poll /api/mind/dashboard/status</p>
            <p className="dash3d-muted">{state.error}</p>
          </div>
        </div>
      ) : null}

      {state.status === "ready" ? <GlassHud data={state.data} /> : null}

      <NodeDetailPanel
        bot={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
