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
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const soundRef = useRef<ReturnType<typeof createHealthSound> | null>(null);
  const [soundMuted, setSoundMuted] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
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
      data-fly-level={fly.level}
      data-labels={operatorPrefs.layers.labels ? "1" : "0"}
      data-health-filter={operatorPrefs.healthFilter}
      onPointerDownCapture={unlockSound}
    >
      {state.status === "ready" && sceneData && !webglError ? (
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
          <MoneyPanel money={state.data.money} />
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
          {operatorPrefs.layers.time ? (
          <TimeScrubber
            timeline={state.data.timeline ?? {
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
            onClick={() => setOperatorOpen(true)}
          >
            Operator (⌘K)
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
      ) : null}

      {state.status === "ready" && !webglError ? <FlyoverHud fly={fly} layout={layoutForHud} /> : null}
      {state.status === "ready" ? (
        <BuildingInteriorPanel
          fly={fly}
          projects={state.data.projects}
          onClose={() => sendFly({ type: "ZOOM_OUT" })}
        />
      ) : null}

      {state.status === "ready" && sceneData && operatorPrefs.layers.feed ? (
        <FeedPanel feed={sceneData.skyFeed ?? state.data.skyFeed} />
      ) : null}
      {state.status === "ready" && sceneData?.charts && operatorPrefs.layers.charts ? (
        <ChartsPanel charts={sceneData.charts} />
      ) : null}
      {state.status === "ready" ? (
        <NotionMirrorPanel
          mirror={state.data.notionMirror}
          onOpenPage={(pageId) => {
            openNotion(pageId);
          }}
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
