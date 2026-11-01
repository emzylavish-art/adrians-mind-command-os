import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ForeverContractPanel } from "./forever-contract-panel";
import { GraphFiltersPanel } from "./graph-filters-panel";
import { resolveLastNodeBreadcrumb, type OperatorPrefs } from "@/lib/mind/dashboard/operator-palette";
import { pollViewData } from "@/lib/mind/dashboard/status-poll";

/** Gap#3: once we have painted a scene this session, never re-show the boot splash. */
let dash3dStagePrimed = false;
import "./dashboard-3d.css";

export function DashboardApp() {
  const { state, refresh } = useDashboardStatus();
  const viewData = useMemo(() => pollViewData(state), [state]);
  if (viewData) dash3dStagePrimed = true;
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
    () => cityLayout ?? buildCityLayout(viewData?.projects ?? null),
    [cityLayout, viewData],
  );
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const soundRef = useRef<ReturnType<typeof createHealthSound> | null>(null);
  const [soundMuted, setSoundMuted] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [perfHint, setPerfHint] = useState<string | null>(null);
  const [operatorPrefs, setOperatorPrefs] = useState<OperatorPrefs>(() => loadInitialOperatorPrefs());
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
  useEffect(() => {
    const id = window.setInterval(() => {
      const hint = document.documentElement.dataset.dashPerf || null;
      setPerfHint((prev) => (prev === hint ? prev : hint));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);


  const unlockSound = useCallback(() => {
    soundRef.current?.unlock();
  }, []);

  const spendView = useMemo(() => {
    const data = pollViewData(state);
    if (!data) return { available: false as const, reason: "no spend source yet" };
    const m = data.money;
    const spend = data.spend;
    // Gap #12: minimal payloads may omit spend/money — never throw on .available
    if (!m?.available) {
      const reason =
        m?.reason ||
        (spend && spend.available === false ? spend.reason : null) ||
        (!spend ? "no spend source yet" : null) ||
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
    if (!viewData) {
      return { data: null as null, mode: "live" as const, message: null as string | null, scrubMs: null as number | null };
    }
    const timeline = viewData.timeline ?? {
      events: [],
      earliestMs: null,
      latestMs: null,
      droppedFuture: 0,
      droppedInvalid: 0,
      truncated: false,
    };
    const liveHealth = Object.fromEntries(
      viewData.bots.map((b) => [b.id, { health: b.health, reason: b.reason }]),
    );
    const target = scrubMs == null ? nowMs : scrubMs;
    const result = scrubAt({
      timeline,
      botIds: viewData.bots.map((b) => b.id),
      liveHealth,
      scrubMs: target,
      nowMs,
    });
    if (result.mode === "live") {
      return { data: viewData, mode: result.mode, message: result.message, scrubMs: null as number | null };
    }
    const bots = applyScrubToBots(viewData.bots, result);
    return {
      data: { ...viewData, bots },
      mode: result.mode,
      message: result.message,
      scrubMs: result.scrubMs,
    };
  }, [viewData, scrubMs, nowMs]);

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
    if (!viewData) return;
    const page = viewData.notionGraph?.pages?.find((p) => p.id === pageId) ?? null;
    setNotionPage(page);
    setSelected(null);
  };

  return (
    <main
      className="dash3d-root dash3d-universe"
      data-testid="dash3d-root"
      data-fly-level={fly.level}
      data-labels={operatorPrefs.layers.labels ? "1" : "0"}
      data-health-filter={operatorPrefs.healthFilter}
      onPointerDownCapture={unlockSound}
    >
      <a className="dash3d-skip-link" href="#dash3d-skybar" data-testid="dash3d-skip-skybar">
        Skip to skybar
      </a>
      {!viewData ? (
        <div id="dash3d-skybar" className="dash3d-skybar" hidden aria-hidden="true" data-testid="dash3d-skybar-fallback" />
      ) : null}
      {sceneData && !webglError ? (
        <UniverseScene
          data={sceneData}
          reducedMotion={reducedMotion}
          onSelectBot={(bot) => {
            setSelected(bot);
            const graph = viewData?.notionGraph;
            const mapped = graph?.botPageMap[bot.id];
            if (mapped && graph) {
              const page = graph.pages.find((p) => p.id === mapped) ?? null;
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
            {viewData ? (
              <ul className="dash3d-list" style={{ marginTop: "0.75rem", textAlign: "left" }}>
                {viewData.bots.map((b) => (
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

      {state.status === "loading" && !viewData && !dash3dStagePrimed ? (
        <div className="dash3d-fallback">
          <div className="dash3d-glass">
            <h2>Adrian&apos;s Mind</h2>
            <p className="dash3d-title">Painting the universe…</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div
          className={`dash3d-status-overlay${viewData ? " is-soft" : ""}`}
          role="status"
          data-testid="status-error-overlay"
        >
          <div className="dash3d-glass dash3d-status-card">
            <h2>{viewData ? "Status stale" : "Status unreachable"}</h2>
            <p className="dash3d-title">{viewData ? "Showing last good scene" : "Retrying with backoff"}</p>
            <p className="dash3d-muted">{state.error}</p>
            <button type="button" className="dash3d-pill" data-testid="status-retry" onClick={() => void refresh()}>
              Retry now
            </button>
          </div>
        </div>
      ) : null}

      {viewData ? (
        <>
        <div className="dash3d-skybar" id="dash3d-skybar" aria-live="polite" role="region" aria-label="Dashboard skybar">
          {state.status === "ready" && state.stale ? (
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
            <p className="dash3d-title">{viewData.weather?.label ?? "—"}</p>
            <p className="dash3d-muted" style={{ fontSize: "0.78rem" }}>{viewData.weather?.summary ?? ""}</p>
          </div>
          {perfHint ? (
            <div className="dash3d-glass dash3d-skybar-card" data-testid="perf-budget-hint" role="status">
              <h2>Perf</h2>
              <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>{perfHint}</p>
            </div>
          ) : null}
          <div className="dash3d-glass dash3d-skybar-card">
            <h2>Notion galaxy</h2>
            <p className="dash3d-title">
              {viewData.notionGraph?.available
                ? `${viewData.notionGraph?.stats?.pages ?? 0} pages · ${viewData.notionGraph?.stats?.edges ?? 0} edges`
                : "Unavailable"}
            </p>
            <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
              {viewData.notionGraph?.mode ?? "—"}
              {viewData.notionGraph?.reason ? ` — ${viewData.notionGraph?.reason.slice(0, 90)}` : ""}
            </p>
          </div>
          <MoneyPanel money={viewData.money} />
          <div className="dash3d-glass dash3d-skybar-card">
            <h2>Fleet plan</h2>
            <p className="dash3d-title">
              {viewData.fleetPlan?.queueHead
                ? `#${viewData.fleetPlan.queueHead.index} ${viewData.fleetPlan.queueHead.title}`
                : viewData.fleetPlan?.queueSource === "unavailable"
                  ? "Queue unavailable"
                  : "Queue empty"}
            </p>
            <p className="dash3d-muted" style={{ fontSize: "0.72rem" }}>
              {(viewData.fleetPlan?.fleetStars ?? []).map((s) => `${s.lane}:${s.health}`).join(" · ") || "—"}
            </p>
          </div>
          {viewData.foreverContract ? <ForeverContractPanel guard={viewData.foreverContract} /> : null}
          {operatorPrefs.layers.time ? (
          <TimeScrubber
            timeline={viewData.timeline ?? {
              events: [],
              earliestMs: null,
              latestMs: null,
              droppedFuture: 0,
              droppedInvalid: 0,
              truncated: false,
            }}
            scrubMs={scrubView.scrubMs}
            nowMs={nowMs}
            message={scrubView.message}
            mode={scrubView.mode}
            onScrubMs={setScrubMs}
          />
          ) : null}
          <button
            type="button"
            className="dash3d-glass dash3d-zoomout"
            data-testid="operator-open"
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            aria-label="Open operator console"
            onClick={() => setOperatorOpen(true)}
          >
            Operator
          </button>
          <button
            type="button"
            className="dash3d-glass dash3d-zoomout"
            data-testid="sound-mute"
            aria-pressed={soundMuted}
            onClick={() => {
              unlockSound();
              const next = !soundMuted;
              soundRef.current?.setMuted(next);
              setSoundMuted(next);
            }}
          >
            {soundMuted ? "Sound muted" : "Sound on"}
          </button>
          <button
            type="button"
            className="dash3d-glass dash3d-zoomout"
            onClick={() => {
              unlockSound();
              setSelected(null);
              setNotionPage(null);
              // scene also listens for empty-space click; this is accessible control
              document.dispatchEvent(new CustomEvent("dash3d-sky"));
            }}
          >
            Zoom to sky
          </button>
        </div>
        </>
      ) : null}

      {viewData && !webglError ? (
        <FlyoverHud
          focusBot={selected}
          fly={fly}
          layout={layoutForHud}
          lastNode={resolveLastNodeBreadcrumb({
            lastNodeId: operatorPrefs.lastNodeId,
            lastNodeKind: operatorPrefs.lastNodeKind,
            bots: viewData.bots,
            buildings: layoutForHud.buildings,
            pages: viewData.notionGraph?.pages ?? null,
          })}
          onRevisitLast={() => {
            const crumb = resolveLastNodeBreadcrumb({
              lastNodeId: operatorPrefs.lastNodeId,
              lastNodeKind: operatorPrefs.lastNodeKind,
              bots: viewData.bots,
              buildings: layoutForHud.buildings,
              pages: viewData.notionGraph?.pages ?? null,
            });
            if (!crumb || crumb.missing) return;
            if (crumb.kind === "bot") {
              const bot = viewData.bots.find((b) => b.id === crumb.id);
              if (bot) {
                setSelected(bot);
                setNotionPage(null);
                document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId: bot.id } }));
              }
            } else if (crumb.kind === "building") {
              setSelected(null);
              setNotionPage(null);
              sendFly({ type: "DIVE" });
              sendFly({ type: "ENTER", buildingId: crumb.id, part: "door" });
            } else if (crumb.kind === "notion") {
              const page = viewData.notionGraph?.pages?.find((x) => x.id === crumb.id) ?? null;
              if (page) {
                setSelected(null);
                setNotionPage(page);
              }
            }
          }}
        />
      ) : null}
      {viewData && fly.level === "interior" ? (
        <BuildingInteriorPanel
          fly={fly}
          projects={viewData.projects}
          bots={viewData.bots}
          onClose={() => sendFly({ type: "ZOOM_OUT" })}
        />
      ) : null}

      {viewData && sceneData && operatorPrefs.layers.feed ? (
        <>
          <GraphFiltersPanel />
          <FeedPanel feed={sceneData.skyFeed ?? viewData.skyFeed} />
        </>
      ) : null}
      {viewData && sceneData?.charts && operatorPrefs.layers.charts ? (
        <ChartsPanel charts={sceneData.charts} />
      ) : null}
      {viewData ? (
        <NotionMirrorPanel
          mirror={viewData.notionMirror}
          onOpenPage={(pageId) => {
            openNotion(pageId);
          }}
        />
      ) : null}
      {viewData ? (
        <OperatorConsole
          bots={viewData.bots}
          buildings={layoutForHud.buildings}
          pages={viewData.notionGraph?.pages ?? []}
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
        status={viewData}
        notionNeighbors={resolveNotionNeighbors(viewData, notionPage?.id)}
        portraitSrc={selected ? `/dashboard-3d/art/portrait-${selected.id}.webp` : null}
        onClose={() => {
          setSelected(null);
          setNotionPage(null);
        }}
      />
    </main>
  );
}
