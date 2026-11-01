import { useCallback, useMemo, useState } from "react";
import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import { NodeDetailPanel, resolveNotionNeighbors } from "./node-detail-panel";
import { UniverseScene } from "./universe-scene";
import { useDashboardStatus } from "./use-dashboard-status";
import { BuildingInteriorPanel, FlyoverHud, sendFly } from "./flyover-hud";
import { FLY_HOME, type FlyState } from "@/lib/mind/dashboard/flyover-fsm";
import { buildCityLayout, type CityLayout } from "@/lib/mind/dashboard/city-layout";
import "./dashboard-3d.css";

export function DashboardApp() {
  const { state } = useDashboardStatus();
  const [selected, setSelected] = useState<BotNode | null>(null);
  const [notionPage, setNotionPage] = useState<NotionSnapPage | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [fly, setFlyState] = useState<FlyState>(FLY_HOME);
  const [cityLayout, setCityLayout] = useState<CityLayout | null>(null);
  const onFlyoverChange = useCallback((next: FlyState, layout: CityLayout) => {
    setFlyState(next);
    setCityLayout(layout);
    if (next.level !== "universe") {
      setSelected(null);
      setNotionPage(null);
    }
  }, []);
  const layoutForHud = useMemo(
    () => cityLayout ?? buildCityLayout(state.status === "ready" ? state.data.projects : null),
    [cityLayout, state],
  );
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const spendView = useMemo(() => {
    if (state.status !== "ready") return { available: false as const, reason: "No source." };
    const s = state.data.spend;
    if (!s.available) return { available: false as const, reason: s.reason || "No source." };
    const n = Array.isArray(s.entries) ? s.entries.length : 0;
    return {
      available: true as const,
      summary: n ? `Live spend log on box · ${n} entr${n === 1 ? "y" : "ies"}` : "Live spend log on box (empty).",
    };
  }, [state]);

  const openNotion = (pageId: string) => {
    if (state.status !== "ready") return;
    const page = state.data.notionGraph.pages.find((p) => p.id === pageId) ?? null;
    setNotionPage(page);
    setSelected(null);
  };

  return (
    <main className="dash3d-root dash3d-universe" data-fly-level={fly.level}>
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
          onFlyoverChange={onFlyoverChange}
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
          {state.stale ? (
            <div className="dash3d-glass dash3d-skybar-card dash3d-stale" role="status" data-testid="status-stale">
              <h2>Status stale</h2>
              <p className="dash3d-title">Showing last good data</p>
              <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
                since {new Date(state.stale.since).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour12: false })} WAT — {state.stale.error.slice(0, 90)}
              </p>
            </div>
          ) : null}
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

      {state.status === "ready" && !webglError ? <FlyoverHud fly={fly} layout={layoutForHud} /> : null}
      {state.status === "ready" ? (
        <BuildingInteriorPanel
          fly={fly}
          projects={state.data.projects}
          onClose={() => sendFly({ type: "ZOOM_OUT" })}
        />
      ) : null}

      <NodeDetailPanel
        bot={selected}
        notionPage={notionPage}
        open={Boolean(selected || notionPage)}
        spend={spendView}
        status={state.status === "ready" ? state.data : null}
        notionNeighbors={resolveNotionNeighbors(state.status === "ready" ? state.data : null, notionPage?.id)}
        portraitSrc={selected ? `/dashboard-3d/art/portrait-${selected.id}.webp` : null}
        onClose={() => {
          setSelected(null);
          setNotionPage(null);
        }}
      />
    </main>
  );
}
