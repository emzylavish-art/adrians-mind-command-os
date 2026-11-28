import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hudDefaultOpen, sortHudCards } from "@/lib/mind/dashboard/hud-order";
import { subscribePrefersReducedMotion } from "./motion";
import { GraphFiltersPanel } from "./graph-filters-panel";
import { MobileChrome, MobilePanelCard, useMobilePanelFocus } from "./mobile-structure";
import { DEFAULT_GRAPH_FILTER, filterBotIds, type GraphFilterState } from "@/lib/mind/dashboard/graph-filters";
import { focusDashboardPanel } from "@/lib/mind/dashboard/view-state";
import type { MobilePanelId } from "./mobile-structure";
import type { BotNode } from "@/lib/mind/dashboard/types";
import { useWorkspaceGraph } from "./use-workspace-graph";
import { NodeDetailPanel, resolveNotionNeighbors } from "./node-detail-panel";
const FleetForceGraph = lazy(() => import("./fleet-force-graph").then((module) => ({ default: module.FleetForceGraph })));
import { useDashboardStatus, type DashboardStatusController } from "./use-dashboard-status";
import { selectedBotFromSnapshot, telemetryDisplay } from "@/lib/mind/dashboard/telemetry-display";
import { BuildingInteriorPanel, FlyoverHud, sendFly } from "./flyover-hud";
import { FLY_HOME, type FlyState } from "@/lib/mind/dashboard/flyover-fsm";
import { buildCityLayout, type CityLayout } from "@/lib/mind/dashboard/city-layout";
import { createHealthSound, type SoundVoiceSpec } from "@/lib/mind/dashboard/health-sound";
import { applyScrubToBots, scrubAt } from "@/lib/mind/dashboard/time-scrub";
import { TimeScrubber } from "./time-scrubber";
import { FeedPanel } from "./feed-panel";
import { MoneyPanel } from "./money-panel";
import { ChartsPanel } from "./charts-panel";
import {
  OperatorConsole,
  loadInitialOperatorPrefs,
  persistOperatorPrefs,
  useOperatorHotkey,
} from "./operator-console";
import { NotionMirrorPanel } from "./notion-mirror-panel";
import type { OperatorPrefs } from "@/lib/mind/dashboard/operator-palette";
import "./dashboard-3d.css";

// Load the existing painterly 3D renderer after hydration. Its Three.js modules
// are not imported during SSR, so the default graph can remain server-safe.
type UniverseComponent = typeof import("./universe-scene")["UniverseScene"];
type UniverseProps = Parameters<UniverseComponent>[0];

function ClientUniverseScene(props: UniverseProps) {
  const [Component, setComponent] = useState<UniverseComponent | null>(null);
  useEffect(() => {
    let active = true;
    void import("./universe-scene")
      .then((mod) => { if (active) setComponent(() => mod.UniverseScene); })
      .catch(() => { if (active) props.onUnavailable("Painterly 3D scene could not be loaded."); });
    return () => { active = false; };
  }, []);
  if (!Component) return <div className="dash3d-fallback"><div className="dash3d-glass">Loading painterly universe…</div></div>;
  return <Component {...props} />;
}

export function DashboardApp({ embedded = false, status }: { embedded?: boolean; status?: DashboardStatusController }) {
  const ownStatus = useDashboardStatus(!status);
  const { state: publicState, refresh, refreshing } = status ?? ownStatus;
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ scope: string | null; id: string } | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [rendererMode, setRendererMode] = useState<"graph" | "universe">("graph");
  const [preferFleetList, setPreferFleetList] = useState(false);
  const workspace = useWorkspaceGraph();
  const state = useMemo(() => publicState.status === "ready" && workspace.graph
    ? { ...publicState, data: { ...publicState.data, notionGraph: workspace.graph } }
    : publicState, [publicState, workspace.graph]);
  const telemetry = telemetryDisplay(state, refreshing);
  const notionPage = selection && selection.scope === workspace.scope && state.status === "ready"
    ? state.data.notionGraph.pages.find((page) => page.id === selection.id) ?? null : null;
  const [fly, setFlyState] = useState<FlyState>(FLY_HOME);
  const [cityLayout, setCityLayout] = useState<CityLayout | null>(null);
  const onFlyoverChange = useCallback((next: FlyState, layout: CityLayout) => {
    setFlyState(next);
    setCityLayout(layout);
    if (next.level !== "universe") {
      setSelectedBotId(null);
      setSelection(null);
    }
  }, []);
  const layoutForHud = useMemo(
    () => cityLayout ?? buildCityLayout(state.status === "ready" ? state.data.projects : null),
    [cityLayout, state],
  );
  // SSR and the first client paint agree on false. matchMedia is read after mount
  // and kept live so a system setting change parks or resumes the scene.
  const [reducedMotion, setReducedMotion] = useState(false);
  const [graphFilter, setGraphFilter] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTER);
  const [narrow, setNarrow] = useState(false);
  const [sceneInteract, setSceneInteract] = useState(true);
  const { focused: panelFocus, setFocused: setPanelFocus, clear: clearPanelFocus } = useMobilePanelFocus();
  useEffect(() => subscribePrefersReducedMotion(setReducedMotion), []);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setNarrow(Boolean(mq.matches));
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const soundRef = useRef<ReturnType<typeof createHealthSound> | null>(null);
  const [soundMuted, setSoundMuted] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorPrefs, setOperatorPrefs] = useState<OperatorPrefs>(() => loadInitialOperatorPrefs());
  const [supportOpen, setSupportOpen] = useState(false);
  const listControl = useRef<HTMLButtonElement | null>(null);
  const navigationOriginRef = useRef<HTMLElement | null>(null);
  const jumpToPanel = (id: MobilePanelId) => {
    navigationOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (id !== "scene") setSupportOpen(true);
    setPanelFocus(id);
  };
  const backFromPanel = () => {
    clearPanelFocus();
    navigationOriginRef.current?.focus();
  };
  useEffect(() => {
    if (!panelFocus || !narrow || (panelFocus !== "scene" && !supportOpen)) return;
    // Runs after React has mounted and expanded the requested panel.
    focusDashboardPanel(document, panelFocus, reducedMotion);
  }, [panelFocus, supportOpen, narrow, reducedMotion]);

  useEffect(() => {
    const sound = createHealthSound({ reducedMotion });
    soundRef.current = sound;
    setSoundMuted(sound.muted);
    const onVis = () => sound.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      sound.dispose();
      soundRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    soundRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    persistOperatorPrefs(operatorPrefs);
    document.documentElement.dataset.dashLabels = operatorPrefs.layers.labels ? "1" : "0";
    // sync sound layer → mute (layer sound true means allow unmute path; still start muted until user enables)
    if (!operatorPrefs.layers.sound) {
      soundRef.current?.setMuted(true);
      setSoundMuted(true);
    }
    document.dispatchEvent(
      new CustomEvent("dash3d-layers", {
        detail: { labels: operatorPrefs.layers.labels, healthFilter: operatorPrefs.healthFilter },
      }),
    );
  }, [operatorPrefs]);

  useOperatorHotkey(() => setOperatorOpen((o) => !o));

  const unlockSound = useCallback(() => {
    soundRef.current?.unlock();
  }, []);

  const spendView = useMemo(() => {
    if (state.status !== "ready") return { available: false as const, reason: "no spend source yet" };
    const m = state.data.money;
    if (!m?.available) {
      const reason =
        m?.reason ||
        (!state.data.spend.available ? state.data.spend.reason : null) ||
        "no spend source yet";
      return { available: false as const, reason };
    }
    const today = m.todayTotalUsd != null ? `today $${m.todayTotalUsd.toFixed(2)}` : "today —";
    const burn = m.burnPerHourUsd != null ? `burn $${m.burnPerHourUsd.toFixed(2)}/hr` : "burn —";
    return {
      available: true as const,
      summary: `${today} · ${burn} · ${m.eventCount} event(s)`,
    };
  }, [state]);

  const nowMs = useMemo(() => Date.now(), [state]);
  const scrubView = useMemo(() => {
    if (state.status !== "ready") {
      return { data: null as null, mode: "live" as const, message: null as string | null, scrubMs: null as number | null };
    }
    const timeline = state.data.timeline ?? {
      events: [],
      earliestMs: null,
      latestMs: null,
      droppedFuture: 0,
      droppedInvalid: 0,
      truncated: false,
    };
    const liveHealth = Object.fromEntries(
      state.data.bots.map((b) => [b.id, { health: b.health, reason: b.reason }]),
    );
    const target = scrubMs == null ? nowMs : scrubMs;
    const result = scrubAt({
      timeline,
      botIds: state.data.bots.map((b) => b.id),
      liveHealth,
      scrubMs: target,
      nowMs,
    });
    if (result.mode === "live") {
      return { data: state.data, mode: result.mode, message: result.message, scrubMs: null as number | null };
    }
    const bots = applyScrubToBots(state.data.bots, result);
    return {
      data: { ...state.data, bots },
      mode: result.mode,
      message: result.message,
      scrubMs: result.scrubMs,
    };
  }, [state, scrubMs, nowMs]);

  const sceneData = scrubView.data;
  const selected = selectedBotId && sceneData
    ? selectedBotFromSnapshot(sceneData.bots, selectedBotId)
    : null;

  const visibleBots = useMemo(() => {
    if (!sceneData) return [];
    const allow = filterBotIds(sceneData.bots, sceneData.constellationEdges ?? [], graphFilter);
    return sceneData.bots.filter((bot) => allow.has(bot.id));
  }, [sceneData, graphFilter]);
  const explicitFleetList = rendererMode === "graph" && preferFleetList;
  const fleetList = rendererMode === "graph" && state.status === "ready" && (explicitFleetList || Boolean(webglError));
  const graphicsAvailable = !fleetList && !webglError && (!narrow || sceneInteract);
  const selectionIsFiltered = rendererMode === "graph" && selected !== null &&
    !visibleBots.some((bot) => bot.id === selected.id);
  const healthTimeLabel = scrubView.mode === "live"
    ? "Latest received health"
    : scrubView.mode === "before_history"
      ? "Historical health unavailable before recorded history"
      : `Historical health at ${new Date(scrubView.scrubMs!).toLocaleString()}`;

  useEffect(() => {
    if (state.status === "ready" && selectedBotId && !selected) setSelectedBotId(null);
  }, [selectedBotId, selected, state.status]);

  useEffect(() => {
    if (!sceneData) {
      soundRef.current?.sync([]);
      return;
    }
    const voices: SoundVoiceSpec[] = sceneData.bots.map((b, i) => ({
      id: b.id,
      health: b.health,
      pan: ((i % 7) - 3) / 3,
    }));
    soundRef.current?.sync(voices);
  }, [sceneData]);

  const selectGraphBot = (bot: BotNode) => {
    if (state.status !== "ready") return;
    setSelectedBotId(bot.id);
    const mapped = state.data.notionGraph.botPageMap[bot.id];
    setSelection(mapped ? { scope: workspace.scope, id: mapped } : null);
  };

  const openNotion = (pageId: string) => {
    if (state.status !== "ready") return;
    setSelection({ scope: workspace.scope, id: pageId });
    setSelectedBotId(null);
  };

  return (
    <main
      className={`dash3d-root dash3d-universe${embedded ? " is-embedded" : ""}`}
      data-testid="dash3d-root"
      data-reduced-motion={reducedMotion ? "1" : "0"}
      data-narrow={narrow ? "1" : "0"}
      data-scene-interact={!narrow || sceneInteract ? "1" : "0"}
      data-fleet-list={fleetList ? "1" : undefined}
      data-panel-focus={panelFocus ?? ""}
      data-fly-level={fly.level}
      data-labels={operatorPrefs.layers.labels ? "1" : "0"}
      data-health-filter={operatorPrefs.healthFilter}
      onPointerDownCapture={unlockSound}
    >
      {state.status === "ready" ? (
        <header className="dash3d-graph-chrome" data-testid="dash3d-graph-chrome">
          <div className="dash3d-glass dash3d-graph-chrome-brand">
            <p className="dash3d-muted" style={{ margin: 0, letterSpacing: "0.08em", fontSize: "0.68rem" }}>
              ADRIAN&apos;S MIND
            </p>
            <h1 className="dash3d-title" style={{ margin: "0.1rem 0 0" }}>
              {fleetList ? "Fleet activity" : rendererMode === "graph" ? "Fleet 3D graph" : "Painterly 3D universe"}
            </h1>
            <p className="dash3d-muted" style={{ margin: "0.15rem 0 0", fontSize: "0.72rem" }}>
              {fleetList ? "Select a record to view details · Cmd/Ctrl-K search" : "Drag rotate · scroll zoom · click node · Cmd/Ctrl-K search"}
            </p>
            <p className="dash3d-muted" role="status" data-telemetry-state={telemetry.tone} style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: telemetry.tone === "stale" ? "#fbbf24" : undefined }}>
              {telemetry.label}. Development activity; runtime readiness unverified.
              {state.data.sources?.commitsSource === "snapshot" ? ` Historical commits: ${state.data.sources.commitsSnapshotAt || "date unknown"}.` : ""}
            </p>
            <p className="dash3d-muted" role="status" style={{ margin: "0.2rem 0 0", fontSize: "0.72rem" }}>
              {workspace.scope && <img src="/brand/logos/notion.svg" alt="" width="16" height="16" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4, background: "white", borderRadius: 3 }} />}
              {workspace.summary || "Public fleet activity"}
              {workspace.graph?.generatedAt && <> · Graph checked <time dateTime={workspace.graph.generatedAt}>{new Date(workspace.graph.generatedAt).toLocaleString()}</time></>}
              {workspace.scope && <> · <button type="button" className="underline" disabled={workspace.checking} onClick={workspace.refresh}>Refresh Notion</button>
                {" · "}<a className="underline" href="/?section=connected#connection-notion">Manage Notion</a></>}
            </p>
          </div>
          <div className="dash3d-graph-chrome-tools">
            <button
              type="button"
              data-testid="switch-force-graph"
              aria-pressed={rendererMode === "graph" && !fleetList}
              className="dash3d-glass dash3d-zoomout"
              onClick={() => { setRendererMode("graph"); setPreferFleetList(false); setWebglError(null); }}
            >
              Graph
            </button>
            {rendererMode === "graph" && (
              <button ref={listControl} type="button" className="dash3d-glass dash3d-zoomout" aria-pressed={fleetList} onClick={() => setPreferFleetList(true)}>
                List
              </button>
            )}
            <button
              type="button"
              data-testid="switch-painterly-universe"
              aria-pressed={rendererMode === "universe"}
              className="dash3d-glass dash3d-zoomout"
              onClick={() => { setRendererMode("universe"); setWebglError(null); }}
            >
              Universe
            </button>
            <GraphFiltersPanel filter={graphFilter} onFilterChange={setGraphFilter} />
            <button
              type="button"
              className="dash3d-glass dash3d-zoomout"
              data-testid="operator-open"
              onClick={() => setOperatorOpen(true)}
            >
              Search graph
            </button>
            <button
              type="button"
              className={`dash3d-glass dash3d-zoomout${supportOpen ? " is-on" : ""}`}
              data-testid="support-panels-toggle"
              aria-pressed={supportOpen}
              onClick={() => setSupportOpen((v) => !v)}
            >
              {supportOpen ? "Hide support panels" : "Support panels"}
            </button>
            <button
              type="button"
              className="dash3d-glass dash3d-zoomout"
              data-testid="zoom-in"
              disabled={!graphicsAvailable}
              aria-label="Zoom in"
              onClick={() => document.dispatchEvent(new CustomEvent("dash3d-zoom", { detail: { factor: 0.8 } }))}
            >
              Zoom +
            </button>
            <button
              type="button"
              className="dash3d-glass dash3d-zoomout"
              data-testid="zoom-out"
              disabled={!graphicsAvailable}
              aria-label="Zoom out"
              onClick={() => document.dispatchEvent(new CustomEvent("dash3d-zoom", { detail: { factor: 1.25 } }))}
            >
              Zoom −
            </button>
            <button
              type="button"
              className="dash3d-glass dash3d-zoomout"
              data-testid="zoom-sky"
              disabled={!graphicsAvailable}
              onClick={() => {
                unlockSound();
                setSelectedBotId(null);
                setSelection(null);
                document.dispatchEvent(new CustomEvent("dash3d-sky"));
              }}
            >
              Zoom to sky
            </button>
          </div>
        </header>
      ) : null}
      {state.status === "ready" && sceneData && graphicsAvailable ? (
        <Suspense fallback={<div className="dash3d-fallback"><div className="dash3d-glass"><p className="dash3d-title">Loading 3D graph…</p></div></div>}>
        {rendererMode === "graph" ? (
          <FleetForceGraph
            key={workspace.scope ?? "public-fleet"}
            data={sceneData}
            filter={graphFilter}
            reducedMotion={reducedMotion}
            onSelectBot={selectGraphBot}
            onSelectNotion={openNotion}
            onSkyView={() => { setSelectedBotId(null); setSelection(null); }}
            onUnavailable={setWebglError}
          />
        ) : (
          <ClientUniverseScene
            key={workspace.scope ?? "public-fleet"}
            data={sceneData}
            filter={graphFilter}
            reducedMotion={reducedMotion}
            onSelectBot={selectGraphBot}
            onSelectNotion={openNotion}
            onSkyView={() => { setSelectedBotId(null); setSelection(null); }}
            onUnavailable={setWebglError}
            onFlyoverChange={onFlyoverChange}
          />
        )}
        </Suspense>
      ) : null}

      {fleetList || webglError ? (
        <section className={fleetList ? "dash3d-fleet-list" : "dash3d-fallback dash3d-operations-fallback"} aria-label="Operations list">
          <div className="dash3d-glass">
            <h2>{explicitFleetList ? "Fleet list" : `${rendererMode === "graph" ? "Graph" : "Universe"} graphics unavailable`}</h2>
            <p className="dash3d-title">Operations overview</p>
            <p className="dash3d-muted">{healthTimeLabel}.</p>
            {webglError && !explicitFleetList && <>
              <button type="button" className="dash3d-pill" data-testid="retry-3d" onClick={() => setWebglError(null)}>Retry 3D</button>
              <p className="dash3d-muted">{webglError}</p>
            </>}
            {state.status === "ready" ? (
              <ul className="dash3d-list" style={{ marginTop: "0.75rem", textAlign: "left" }}>
                {visibleBots.map((b) => (
                  <li key={b.id}>
                    <button type="button" className="dash3d-pill" aria-label={fleetList ? `${b.name}, ${b.health}` : undefined} onClick={() => rendererMode === "graph" ? selectGraphBot(b) : setSelectedBotId(b.id)}>
                      <span className={`dash3d-dot ${b.health}`} aria-hidden={fleetList || undefined} />
                      {b.name}
                    </button>
                  </li>
                ))}
                {state.data.notionGraph.pages.map((item) => (
                  <li key={item.id}><button type="button" className="dash3d-pill" onClick={() => openNotion(item.id)}>
                    {item.title} · {item.kind}
                  </button></li>
                ))}
              </ul>
            ) : null}
            {!visibleBots.length && !(state.status === "ready" && state.data.notionGraph.pages.length) ? <p className="dash3d-muted">No records match the selected filters.</p> : null}
          </div>
        </section>
      ) : null}

      {state.status === "loading" ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Adrian&apos;s Mind</h2>
            <p className="dash3d-title">Loading fleet activity…</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <p className="dash3d-title">The map did not load</p>
            <p className="dash3d-muted">{state.error}</p>
            <button type="button" className="dash3d-glass dash3d-zoomout" onClick={() => void refresh()}>Retry</button>
          </div>
        </div>
      ) : null}

      {state.status === "ready" && narrow ? (
        <MobileChrome
          sceneInteract={sceneInteract}
          onSceneInteract={setSceneInteract}
          graphicsAvailable={!fleetList && !webglError}
          filtersSlot={<GraphFiltersPanel triggerOnly filter={graphFilter} onFilterChange={setGraphFilter} />}
          focused={panelFocus}
          onJump={jumpToPanel}
          onBack={backFromPanel}
        />
      ) : null}
      {state.status === "ready" && supportOpen ? (
        <div className="dash3d-panel-stack" data-testid="dash3d-panel-stack">
        {sortHudCards([
          { id: "weather" as const, band: state.data.weather.tone === "blocked" || state.data.weather.tone === "stalled" ? "needs" as const : "status" as const, seq: 0, title: "System weather", summary: state.data.weather.label, col: "left" as const },
          { id: "notion" as const, band: state.data.notionGraph.available ? "status" as const : "needs" as const, seq: 1, title: "Notion workspace", summary: workspace.summary || "Unavailable", col: "left" as const },
          { id: "money" as const, band: state.data.money?.available ? "status" as const : "needs" as const, seq: 2, title: "Money", summary: state.data.money?.available ? "Spend" : "no spend source yet", col: "left" as const },
          { id: "fleet" as const, band: state.data.fleetPlan?.queueHead ? "status" as const : "needs" as const, seq: 3, title: "Fleet plan", summary: state.data.fleetPlan?.queueHead?.title ?? "Queue unavailable", col: "left" as const },
          { id: "compass" as const, band: state.data.bots.some((bot) => bot.health === "blocked") ? "needs" as const : "status" as const, seq: 4, title: "Universe list", summary: `${state.data.bots.length} from status`, col: "left" as const },
          { id: "time" as const, band: "status" as const, seq: 5, title: "Time", summary: scrubView.mode, col: "left" as const },
          { id: "mirror" as const, band: "status" as const, seq: 6, title: "Notion mirror", summary: state.data.notionMirror.available ? "Mapped" : "Unavailable", col: "left" as const },
          { id: "feed" as const, band: "status" as const, seq: 7, title: "Feed", summary: `${sceneData?.skyFeed?.list.length ?? state.data.skyFeed.list.length} events`, col: "left" as const },
          { id: "filters" as const, band: "status" as const, seq: 8, title: "Filters", summary: "Search · health · lane", col: "left" as const },
          { id: "controls" as const, band: "status" as const, seq: 9, title: "Controls", summary: "Operator", col: "right" as const },
          { id: "flyhud" as const, band: "status" as const, seq: 10, title: "Flyover", summary: fly.level, col: "right" as const },
          { id: "charts" as const, band: "charts" as const, seq: 0, title: "Charts", summary: "From status", col: "right" as const },
        ]).map((card, index) => (
          <div key={card.id} className="dash3d-hud-card" data-hud-card="1" data-hud-col={card.col} data-hud-band={card.band}>
            <MobilePanelCard
              id={card.id}
              title={card.title}
              summary={card.summary}
              defaultOpen={hudDefaultOpen(index, card.band)}
              focused={panelFocus}
              onFocus={setPanelFocus}
            >
              {card.id === "weather" ? (
                <div className="dash3d-glass dash3d-skybar-card">
                  <h2>System weather</h2>
                  <p className="dash3d-title">{state.data.weather.label}</p>
                  <p className="dash3d-muted">{state.data.weather.summary}</p>
                </div>
              ) : null}
              {card.id === "notion" ? (
                <div className="dash3d-glass dash3d-skybar-card">
                  <h2>Notion workspace</h2>
                  <p className="dash3d-title">{state.data.notionGraph.available ? `${state.data.notionGraph.stats.pages} pages · ${state.data.notionGraph.stats.agents ?? 0} agents · ${state.data.notionGraph.stats.edges} links` : "Unavailable"}</p>
                  <p className="dash3d-muted">{state.data.notionGraph.mode}{state.data.notionGraph.reason ? ` — ${state.data.notionGraph.reason}` : ""}</p>
                </div>
              ) : null}
              {card.id === "money" ? <MoneyPanel money={state.data.money} /> : null}
              {card.id === "fleet" ? (
                <div className="dash3d-glass dash3d-skybar-card">
                  <h2>Fleet plan</h2>
                  <p className="dash3d-title">{state.data.fleetPlan?.queueHead ? `#${state.data.fleetPlan.queueHead.index} ${state.data.fleetPlan.queueHead.title}` : "Queue unavailable"}</p>
                  <p className="dash3d-muted">{(state.data.fleetPlan?.fleetStars ?? []).map((star) => `${star.lane}:${star.health}`).join(" · ") || "—"}</p>
                </div>
              ) : null}
              {card.id === "compass" ? (
                <section className="dash3d-plain-fallback" data-testid="dash3d-plain-fallback" aria-label="Universe list">
                  <p className="dash3d-muted">Same status payload as the scene. {state.data.weather.label}: {state.data.weather.summary}</p>
                  <ul className="dash3d-list">
                    {visibleBots.map((bot) => (
                      <li key={bot.id}>
                        <button type="button" className="dash3d-pill" onClick={() => setSelectedBotId(bot.id)}>
                          <span className={`dash3d-dot ${bot.health}`} />
                          {bot.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {card.id === "time" && operatorPrefs.layers.time ? (
                <TimeScrubber
                  timeline={state.data.timeline ?? { events: [], earliestMs: null, latestMs: null, droppedFuture: 0, droppedInvalid: 0, truncated: false }}
                  scrubMs={scrubView.scrubMs}
                  nowMs={nowMs}
                  message={scrubView.message}
                  mode={scrubView.mode}
                  onScrubMs={setScrubMs}
                />
              ) : null}
              {card.id === "mirror" ? (
                <NotionMirrorPanel mirror={state.data.notionMirror} onOpenPage={openNotion} />
              ) : null}
              {card.id === "feed" && sceneData && operatorPrefs.layers.feed ? (
                <FeedPanel feed={sceneData.skyFeed ?? state.data.skyFeed} />
              ) : null}
              {card.id === "filters" ? <GraphFiltersPanel filter={graphFilter} onFilterChange={setGraphFilter} /> : null}
              {card.id === "controls" ? (
                <div className="dash3d-flyhud-row">
                  {state.stale ? <p className="dash3d-muted" data-testid="status-stale">Status stale — showing last good data. {state.stale.error}</p> : null}
                  <button type="button" className="dash3d-glass dash3d-zoomout" data-testid="sound-mute" aria-pressed={soundMuted} onClick={() => { unlockSound(); const next = !soundMuted; soundRef.current?.setMuted(next); setSoundMuted(next); }}>{soundMuted ? "Sound muted" : "Sound on"}</button>
                </div>
              ) : null}
              {card.id === "flyhud" ? graphicsAvailable ? <FlyoverHud fly={fly} layout={layoutForHud} /> : <p className="dash3d-muted">Flyover requires the 3D scene. Operational records remain available in the Universe list.</p> : null}
              {card.id === "charts" ? !operatorPrefs.layers.charts ? <p className="dash3d-muted">Charts are hidden. Enable the Charts layer in Search records.</p> : sceneData?.charts ? <ChartsPanel charts={sceneData.charts} /> : <p className="dash3d-muted">No chart data is available.</p> : null}
              {card.id === "feed" && !operatorPrefs.layers.feed ? <p className="dash3d-muted">Feed is hidden. Enable the Feed layer in Search records.</p> : null}
              {card.id === "time" && !operatorPrefs.layers.time ? <p className="dash3d-muted">Time is hidden. Enable the Time layer in Search records.</p> : null}
            </MobilePanelCard>
          </div>
        ))}
        </div>
      ) : null}
      {state.status === "ready" ? (
        <BuildingInteriorPanel
          fly={fly}
          projects={state.data.projects}
          bots={visibleBots}
          onClose={() => sendFly({ type: "ZOOM_OUT" })}
        />
      ) : null}
      {state.status === "ready" ? (
        <OperatorConsole
          bots={visibleBots}
          buildings={layoutForHud.buildings}
          pages={state.data.notionGraph.pages}
          open={operatorOpen}
          onOpenChange={setOperatorOpen}
          prefs={operatorPrefs}
          onPrefsChange={setOperatorPrefs}
          onFlyBot={(botId) => {
            document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId } }));
          }}
          onOpenNotion={openNotion}
          onSelectBot={(bot) => {
            setSelectedBotId(bot.id);
          }}
        />
      ) : null}

      <NodeDetailPanel
        bot={selected}
        inlineView={fleetList}
        healthTimeLabel={scrubView.mode !== "live" ? healthTimeLabel : undefined}
        hiddenByFilters={selectionIsFiltered}
        notionPage={notionPage}
        open={Boolean(selected || notionPage)}
        spend={spendView}
        status={state.status === "ready" ? state.data : null}
        notionNeighbors={resolveNotionNeighbors(state.status === "ready" ? state.data : null, notionPage?.id)}
        portraitSrc={selected ? `/dashboard-3d/art/portrait-${selected.id}.webp` : null}
        onClose={() => {
          setSelectedBotId(null);
          setSelection(null);
          if (fleetList) listControl.current?.focus();
        }}
      />
    </main>
  );
}
