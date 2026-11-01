import { useMemo, useState } from "react";
import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import { NodeDetailPanel } from "./node-detail-panel";
import { UniverseScene } from "./universe-scene";
import { useDashboardStatus } from "./use-dashboard-status";
import "./dashboard-3d.css";

export function DashboardApp() {
  const { state } = useDashboardStatus();
  const [selected, setSelected] = useState<BotNode | null>(null);
  const [notionPage, setNotionPage] = useState<NotionSnapPage | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const openNotion = (pageId: string) => {
    if (state.status !== "ready") return;
    const page = state.data.notionGraph.pages.find((p) => p.id === pageId) ?? null;
    setNotionPage(page);
    setSelected(null);
  };

  return (
    <main className="dash3d-root dash3d-universe">
      {state.status === "ready" && !webglError ? (
        <UniverseScene
          data={state.data}
          reducedMotion={reducedMotion}
          onSelectBot={(bot) => {
            setSelected(bot);
            const mapped = state.data.notionGraph.botPageMap[bot.id];
            if (mapped) {
              const page = state.data.notionGraph.pages.find((p) => p.id === mapped) ?? null;
              setNotionPage(page);
            } else {
              setNotionPage(null);
            }
          }}
          onSelectNotion={openNotion}
          onSkyView={() => {
            setSelected(null);
            setNotionPage(null);
          }}
          onUnavailable={setWebglError}
        />
      ) : null}

      {webglError ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Universe unavailable</h2>
            <p className="dash3d-title">WebGL fallback</p>
            <p className="dash3d-muted">{webglError}</p>
            {state.status === "ready" ? (
              <ul className="dash3d-list" style={{ marginTop: "0.75rem", textAlign: "left" }}>
                {state.data.bots.map((b) => (
                  <li key={b.id}>
                    <button type="button" className="dash3d-pill" onClick={() => setSelected(b)}>
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
            <h2>Adrian&apos;s Mind</h2>
            <p className="dash3d-title">Painting the universe…</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Status error</h2>
            <p className="dash3d-muted">{state.error}</p>
          </div>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="dash3d-skybar" aria-live="polite">
          <div className="dash3d-glass dash3d-skybar-card">
            <h2>System weather</h2>
            <p className="dash3d-title">{state.data.weather.label}</p>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>{state.data.weather.summary}</p>
          </div>
          <div className="dash3d-glass dash3d-skybar-card">
            <h2>Notion galaxy</h2>
            <p className="dash3d-title">
              {state.data.notionGraph.available
                ? `${state.data.notionGraph.stats.pages} pages · ${state.data.notionGraph.stats.edges} edges`
                : "Unavailable"}
            </p>
            <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
              {state.data.notionGraph.mode}
              {state.data.notionGraph.reason ? ` — ${state.data.notionGraph.reason.slice(0, 90)}` : ""}
            </p>
          </div>
          <div className="dash3d-glass dash3d-skybar-card">
            <h2>Fleet plan</h2>
            <p className="dash3d-title">
              {state.data.fleetPlan?.queueHead
                ? `#${state.data.fleetPlan.queueHead.index} ${state.data.fleetPlan.queueHead.title}`
                : "Queue"}
            </p>
            <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
              {(state.data.fleetPlan?.fleetStars ?? []).map((s) => `${s.lane}:${s.health}`).join(" · ") || "—"}
            </p>
          </div>
          <button
            type="button"
            className="dash3d-glass dash3d-zoomout"
            onClick={() => {
              setSelected(null);
              setNotionPage(null);
              // scene also listens for empty-space click; this is accessible control
              document.dispatchEvent(new CustomEvent("dash3d-sky"));
            }}
          >
            Zoom to sky
          </button>
        </div>
      ) : null}

      <NodeDetailPanel
        bot={selected}
        notionPage={notionPage}
        open={Boolean(selected || notionPage)}
        onClose={() => {
          setSelected(null);
          setNotionPage(null);
        }}
      />
    </main>
  );
}
