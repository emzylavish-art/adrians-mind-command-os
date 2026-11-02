import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotNode } from "@/lib/mind/dashboard/types";
import type { NotionSnapPage } from "@/lib/mind/dashboard/notion-graph-core";
import { NodeDetailPanel, resolveNotionNeighbors } from "./node-detail-panel";
import { useDashboardStatus } from "./use-dashboard-status";
import { BuildingInteriorPanel, FlyoverHud, sendFly } from "./flyover-hud";
import { FLY_HOME, type FlyState } from "@/lib/mind/dashboard/flyover-fsm";
import { buildCityLayout, type CityLayout } from "@/lib/mind/dashboard/city-layout";
import type { SoundVoiceSpec } from "@/lib/mind/dashboard/health-sound";
import { applyScrubToBots, formatWat, scrubAt } from "@/lib/mind/dashboard/time-scrub";
import { buildDashboardCharts } from "@/lib/mind/dashboard/chart-series";
import { TimeScrubber } from "./time-scrubber";
import { FeedPanel } from "./feed-panel";
import { MoneyPanel } from "./money-panel";
import { adjustBurnForHiddenGap } from "@/lib/mind/dashboard/spend-core";

/** Perf: three.js + postfx + lore live behind UniverseScene; charts behind ChartsPanel. */
const UniverseScene = lazy(() =>
  import("./universe-scene").then((m) => ({ default: m.UniverseScene })),
);
const ChartsPanel = lazy(() =>
  import("./charts-panel").then((m) => ({ default: m.ChartsPanel })),
);
import {
  OperatorConsole,
  loadInitialOperatorPrefs,
  persistOperatorPrefs,
  useOperatorHotkey,
} from "./operator-console";
import { DEFAULT_PREFS } from "@/lib/mind/dashboard/operator-palette";
import { NotionMirrorPanel } from "./notion-mirror-panel";
import { ForeverContractPanel } from "./forever-contract-panel";
import { GraphFiltersPanel } from "./graph-filters-panel";
import { MinimapPanel } from "./minimap-panel";
import { portraitUrlForBot, clearPortraitBackoffOnOnline } from "@/lib/mind/dashboard/portrait-resolve";
import { ensureDashboardArtUrls } from "@/lib/mind/dashboard/art-urls";
import { buildViewUrlSearch, parseViewUrlSearch, type ViewLevel } from "@/lib/mind/dashboard/view-url";
import { resolveLastNodeBreadcrumb, type OperatorPrefs } from "@/lib/mind/dashboard/operator-palette";
import { pollViewData } from "@/lib/mind/dashboard/status-poll";
import "./dashboard-3d.css";

export function DashboardApp() {
  const { state, refresh, hiddenGapMs } = useDashboardStatus();
  const viewData = useMemo(() => pollViewData(state), [state]);
  // Gap#3 / hydration: stagePrimed only flips after mount+data (never during SSR render).
  const [stagePrimed, setStagePrimed] = useState(false);
  const [selected, setSelected] = useState<BotNode | null>(null);
  const [nhopDepth, setNhopDepth] = useState(0);
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
  // Hydration-safe: SSR + first client paint agree on false; read matchMedia after mount.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(!!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  type HealthSoundHandle = {
    sync: (voices: SoundVoiceSpec[]) => void;
    setMuted: (muted: boolean) => void;
    setReducedMotion?: (r: boolean) => void;
    unlock?: () => void;
    setHidden?: (h: boolean) => void;
    muted?: boolean;
    dispose?: () => void;
  };
  const soundRef = useRef<HealthSoundHandle | null>(null);

  const [soundMuted, setSoundMuted] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [hudFocus, setHudFocus] = useState(false);
  const urlBootstrapped = useRef(false);

  // Fleet signed URLs for Imagine / portrait / scene art (media-brand).
  useEffect(() => {
    void ensureDashboardArtUrls();
  }, []);

  // Gap#16 / #39 — hydrate focus+level from URL once bots exist.
  useEffect(() => {
    if (!viewData || urlBootstrapped.current) return;
    if (typeof window === "undefined") return;
    urlBootstrapped.current = true;
    const allowed = new Set(viewData.bots.map((b) => b.id));
    const parsed = parseViewUrlSearch(window.location.search, allowed);
    if (parsed.focus) {
      const bot = viewData.bots.find((b) => b.id === parsed.focus) ?? null;
      if (bot) {
        setSelected(bot);
        document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId: bot.id } }));
      }
    }
    if (parsed.level === "city") sendFly({ type: "DIVE" });
    else if (parsed.level === "interior") {
      sendFly({ type: "DIVE" });
      // interior without building stays at city; honest
    }
  }, [viewData]);

  // Write URL on selection / fly level (replace on focus, push on level change).
  const lastLevel = useRef<ViewLevel>("universe");
  useEffect(() => {
    if (typeof window === "undefined" || !urlBootstrapped.current) return;
    const level = (fly.level === "interior" || fly.level === "city" || fly.level === "universe"
      ? fly.level
      : "universe") as ViewLevel;
    const next = buildViewUrlSearch({ focus: selected?.id ?? null, level });
    const url = `${window.location.pathname}${next}${window.location.hash}`;
    if (level !== lastLevel.current) {
      window.history.pushState({ dash3d: true, level, focus: selected?.id ?? null }, "", url);
      lastLevel.current = level;
    } else {
      window.history.replaceState({ dash3d: true, level, focus: selected?.id ?? null }, "", url);
    }
  }, [selected?.id, fly.level]);

  useEffect(() => {
    const onPop = () => {
      if (typeof window === "undefined") return;
      const allowed = new Set((viewData?.bots ?? []).map((b) => b.id));
      const parsed = parseViewUrlSearch(window.location.search, allowed);
      lastLevel.current = parsed.level;
      if (parsed.level === "universe") sendFly({ type: "SKY" });
      else if (parsed.level === "city") sendFly({ type: "DIVE" });
      if (parsed.focus) {
        document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId: parsed.focus } }));
      } else {
        setSelected(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [viewData]);

  useEffect(() => {
    if (viewData) setStagePrimed(true);
  }, [viewData]);

  const [perfHint, setPerfHint] = useState<string | null>(null);
  const [operatorPrefs, setOperatorPrefs] = useState<OperatorPrefs>(() => ({
    ...DEFAULT_PREFS,
    layers: { ...DEFAULT_PREFS.layers },
  }));
  useEffect(() => {
    // Client-only prefs after hydrate (localStorage must not affect first paint).
    setOperatorPrefs(loadInitialOperatorPrefs());
  }, []);
  useEffect(() => {
    let sound: (HealthSoundHandle & { setHidden?: (h: boolean) => void; setReducedMotion?: (r: boolean) => void; unlock?: () => void; muted?: boolean; dispose: () => void }) | null = null;
    let cancelled = false;
    const onVis = () => sound?.setHidden?.(document.hidden);
    void import("@/lib/mind/dashboard/health-sound").then(({ createHealthSound }) => {
      if (cancelled) return;
      sound = createHealthSound({ reducedMotion }) as typeof sound;
      soundRef.current = sound;
      sound?.setMuted(true);
      setSoundMuted(Boolean(sound?.muted ?? true));
      onVis();
    });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { sound?.dispose(); } catch { /* */ }
      if (soundRef.current === sound) soundRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    soundRef.current?.setReducedMotion?.(reducedMotion);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setHudFocus((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      const hint = document.documentElement.dataset.dashPerf || null;
      setPerfHint((prev) => (prev === hint ? prev : hint));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);


  const unlockSound = useCallback(() => {
    soundRef.current?.unlock?.();
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

  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    // Gap#21: avoid SSR/client Date.now mismatch — set clock after mount only.
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [state.status]);
  const scrubView = useMemo(() => {
    if (!viewData) {
      return { data: null as null, mode: "live" as const, message: null as string | null, scrubMs: null as number | null };
    }
    if (nowMs == null) {
      return { data: viewData, mode: "live" as const, message: null as string | null, scrubMs: null as number | null };
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
    const clock = nowMs ?? 0;
    const target = scrubMs == null ? clock : scrubMs;
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
  // Gap#48: Charts follow scrub via rebuild-at-scrubMs; Money/Forever stay Live with an honest note.
  const scrubPanelNote =
    scrubView.mode !== "live" && scrubView.scrubMs != null
      ? `Showing Live ledger/queue — not ${formatWat(scrubView.scrubMs)}`
      : null;
  const chartsForScrub = (() => {
    if (!viewData?.charts) return null;
    if (scrubView.mode === "live" || scrubView.scrubMs == null || !sceneData) return viewData.charts;
    return buildDashboardCharts({
      commits: viewData.commits,
      timeline: viewData.timeline,
      landings: viewData.fleetPlan?.landings ?? null,
      money: viewData.money,
      bots: sceneData.bots,
      nowMs: scrubView.scrubMs,
    });
  })();


  // Gap#40 — one retry wave when connectivity returns (no request storm while offline).
  useEffect(() => {
    const onOnline = () => clearPortraitBackoffOnOnline();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Gap#42 — Star Detail must track live status; close when the bot disappears.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) return;
    const bots = viewData?.bots;
    if (!bots) return;
    const fresh = bots.find((b) => b.id === selectedId);
    if (!fresh) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (!prev || prev.id !== fresh.id) return fresh;
      if (
        prev.health !== fresh.health ||
        prev.reason !== fresh.reason ||
        prev.lastActivityAt !== fresh.lastActivityAt ||
        prev.notes !== fresh.notes ||
        prev.branch !== fresh.branch ||
        prev.lock?.heartbeatAt !== fresh.lock?.heartbeatAt ||
        prev.lock?.status !== fresh.lock?.status ||
        prev.lock?.claimed_at !== fresh.lock?.claimed_at
      ) {
        return fresh;
      }
      return prev;
    });
  }, [viewData?.bots, selectedId]);


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
      data-hud-focus={hudFocus ? "1" : "0"}
      onPointerDownCapture={unlockSound}
    >
      <a className="dash3d-skip-link" href="#dash3d-skybar" data-testid="dash3d-skip-skybar">
        Skip to skybar
      </a>
      <button
        type="button"
        className="dash3d-hud-focus-toggle dash3d-pill"
        data-testid="hud-focus-toggle"
        aria-pressed={hudFocus}
        onClick={() => setHudFocus((v) => !v)}
      >
        {hudFocus ? "Show HUD" : "Focus stage"}
      </button>
      {!viewData ? (
        <div id="dash3d-skybar" className="dash3d-skybar" hidden aria-hidden="true" data-testid="dash3d-skybar-fallback" />
      ) : null}
      {sceneData && !webglError ? (
        <Suspense fallback={<div className="dash3d-canvas-wrap" data-testid="dash3d-scene-fallback" aria-busy="true" />}>
        <UniverseScene
          data={sceneData}
          reducedMotion={reducedMotion}
          onSelectBot={(bot) => {
            setSelected(bot);
            // Gap#59: lazy per-node detail (excerpts) without fat poll payload.
            void fetch(`/api/mind/dashboard/status?bot=${encodeURIComponent(bot.id)}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => {
                if (!j?.botDetail?.ok || !j.botDetail.bot) return;
                const fresh = j.botDetail.bot;
                setSelected((prev) => (prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev));
              })
              .catch(() => {});
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
        </Suspense>
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

      {state.status === "loading" && !viewData && !stagePrimed ? (
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
        <div className="dash3d-skybar" id="dash3d-skybar" role="region" aria-label="Dashboard skybar">
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
          <MoneyPanel money={adjustBurnForHiddenGap(viewData.money, hiddenGapMs ?? 0)} scrubNote={scrubPanelNote} />
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
          {viewData.foreverContract ? <ForeverContractPanel guard={viewData.foreverContract} scrubNote={scrubPanelNote} /> : null}
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
            nowMs={nowMs ?? 0}
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

      {viewData ? <MinimapPanel bots={viewData.bots} focusId={selected?.id} /> : null}
      {viewData && sceneData && operatorPrefs.layers.feed ? (
        <>
          <GraphFiltersPanel />
          <FeedPanel feed={sceneData.skyFeed ?? viewData.skyFeed} />
        </>
      ) : null}
      {viewData && chartsForScrub && operatorPrefs.layers.charts ? (
        <Suspense fallback={<aside className="dash3d-charts-panel dash3d-glass" data-testid="charts-fallback" aria-busy="true"><h2>Charts</h2><p className="dash3d-muted">Loading…</p></aside>}>
        <ChartsPanel
          charts={chartsForScrub}
          scrubNote={
            scrubView.mode !== "live" && scrubView.scrubMs != null
              ? `Charts at ${formatWat(scrubView.scrubMs)} (health/commits/locks clipped to scrub)`
              : null
          }
          onSelectBotId={(id) => {
            const bot = viewData.bots.find((b) => b.id === id || b.id.startsWith(id) || id.startsWith(b.id));
            if (!bot) return;
            setSelected(bot);
            document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId: bot.id } }));
          }}
          onScrubRatio={(ratio) => {
            const tl = viewData.timeline;
            if (!tl?.earliestMs || !tl.latestMs) return;
            const span = Math.max(1, tl.latestMs - tl.earliestMs);
            setScrubMs(tl.earliestMs + ratio * span);
          }}
        />
        </Suspense>
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
        portraitSrc={selected ? portraitUrlForBot(selected.id) : null}
        nhopDepth={nhopDepth}
        onNhopDepth={setNhopDepth}
        onClose={() => {
          setSelected(null);
          setNotionPage(null);
        }}
      />
    </main>
  );
}
