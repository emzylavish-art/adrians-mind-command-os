import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hudDefaultOpen, sortHudCards } from "@/lib/mind/dashboard/hud-order";
import { subscribePrefersReducedMotion } from "./motion";
import { GraphFiltersPanel } from "./graph-filters-panel";
import { MobileChrome, MobilePanelCard, useMobilePanelFocus } from "./mobile-structure";
import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import { NodeDetailPanel, resolveNotionNeighbors } from "./node-detail-panel";
import { UniverseScene } from "./universe-scene";
import { useDashboardStatus } from "./use-dashboard-status";
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

export function DashboardApp({ embedded = false }: { embedded?: boolean }) {
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
  // SSR and the first client paint agree on false. matchMedia is read after mount
  // and kept live so a system setting change parks or resumes the scene.
  const [reducedMotion, setReducedMotion] = useState(false);
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

  const openNotion = (pageId: string) => {
    if (state.status !== "ready") return;
    const page = state.data.notionGraph.pages.find((p) => p.id === pageId) ?? null;
    setNotionPage(page);
    setSelected(null);
  };

  return (
    <main
      className={`dash3d-root dash3d-universe${embedded ? " is-embedded" : ""}`}
      data-testid="dash3d-root"
      data-reduced-motion={reducedMotion ? "1" : "0"}
      data-narrow={narrow ? "1" : "0"}
      data-scene-interact={!narrow || sceneInteract ? "1" : "0"}
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
              Fleet 3D graph
            </h1>
            <p className="dash3d-muted" style={{ margin: "0.15rem 0 0", fontSize: "0.72rem" }}>
              Drag rotate · scroll zoom · click node · Cmd/Ctrl-K search
            </p>
          </div>
          <div className="dash3d-graph-chrome-tools">
            <GraphFiltersPanel />
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
              data-testid="zoom-sky"
              onClick={() => {
                unlockSound();
                setSelected(null);
                setNotionPage(null);
                document.dispatchEvent(new CustomEvent("dash3d-sky"));
              }}
            >
              Zoom to sky
            </button>
          </div>
        </header>
      ) : null}
      {state.status === "ready" && sceneData && !webglError && (!narrow || sceneInteract) ? (
        <UniverseScene
          data={sceneData}
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

      {state.status === "ready" && narrow ? (
        <MobileChrome
          sceneInteract={sceneInteract}
          onSceneInteract={setSceneInteract}
          filtersSlot={<GraphFiltersPanel triggerOnly />}
          focused={panelFocus}
          onJump={setPanelFocus}
          onBack={clearPanelFocus}
        />
      ) : null}
      {state.status === "ready" && supportOpen ? (
        <div className="dash3d-panel-stack" data-testid="dash3d-panel-stack">
        {sortHudCards([
          { id: "weather" as const, band: state.data.weather.tone === "blocked" || state.data.weather.tone === "stalled" ? "needs" as const : "status" as const, seq: 0, title: "System weather", summary: state.data.weather.label, col: "left" as const },
          { id: "notion" as const, band: state.data.notionGraph.available ? "status" as const : "needs" as const, seq: 1, title: "Notion galaxy", summary: state.data.notionGraph.available ? `${state.data.notionGraph.stats.pages} pages` : "Unavailable", col: "left" as const },
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
              defaultOpen={hudDefaultOpen(index)}
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
                  <h2>Notion galaxy</h2>
                  <p className="dash3d-title">{state.data.notionGraph.available ? `${state.data.notionGraph.stats.pages} pages · ${state.data.notionGraph.stats.edges} edges` : "Unavailable"}</p>
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
                    {state.data.bots.map((bot) => (
                      <li key={bot.id}>
                        <button type="button" className="dash3d-pill" onClick={() => setSelected(bot)}>
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
              {card.id === "filters" ? <GraphFiltersPanel /> : null}
              {card.id === "controls" ? (
                <div className="dash3d-flyhud-row">
                  {state.stale ? <p className="dash3d-muted" data-testid="status-stale">Status stale — showing last good data. {state.stale.error}</p> : null}
                  <button type="button" className="dash3d-glass dash3d-zoomout" data-testid="sound-mute" aria-pressed={soundMuted} onClick={() => { unlockSound(); const next = !soundMuted; soundRef.current?.setMuted(next); setSoundMuted(next); }}>{soundMuted ? "Sound muted" : "Sound on"}</button>
                </div>
              ) : null}
              {card.id === "flyhud" && !webglError ? <FlyoverHud fly={fly} layout={layoutForHud} /> : null}
              {card.id === "charts" && sceneData?.charts && operatorPrefs.layers.charts ? <ChartsPanel charts={sceneData.charts} /> : null}
            </MobilePanelCard>
          </div>
        ))}
        </div>
      ) : null}
      {state.status === "ready" ? (
        <BuildingInteriorPanel
          fly={fly}
          projects={state.data.projects}
          bots={state.data.bots}
          onClose={() => sendFly({ type: "ZOOM_OUT" })}
        />
      ) : null}
      {state.status === "ready" ? (
        <OperatorConsole
          bots={state.data.bots}
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
            setSelected(bot);
          }}
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
