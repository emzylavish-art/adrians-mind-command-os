import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as telemetry from "../../../lib/mind/dashboard/telemetry-display.ts";
import { DEFAULT_GRAPH_FILTER, filterBotIds } from "../../../lib/mind/dashboard/graph-filters.ts";
import { applyScrubToBots, scrubAt } from "../../../lib/mind/dashboard/time-scrub.ts";
import { focusDashboardPanel } from "../../../lib/mind/dashboard/view-state.ts";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
type Element = { type: unknown; props: Record<string, any> };
function descendants(value: any): Element[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!value || typeof value !== "object" || !value.props) return [];
  return [value, ...descendants(value.props.children)];
}

/** Execute the actual component's render/handlers using deterministic hook slots.
 * This is a source integration fixture, not a real browser/GPU claim. */
function dashboardFixture() {
  let cursor = 0;
  const slots: any[] = [];
  let effects: Array<() => void> = [];
  let focused: string | null = null;
  const scrolls: any[] = [];
  let mounted = false;
  let focusedElement = false;
  const now = Date.now();
  const current = { id: "dashboard", name: "Dashboard", health: "blocked", reason: "Latest blocked", branch: "dashboard-3d", notes: "" };
  const data = {
    bots: [current], commits: [], projects: null, constellationEdges: [],
    notionGraph: { pages: [], botPageMap: {}, stats: { pages: 0, edges: 0 }, mode: "unavailable", available: false },
    weather: { tone: "blocked", label: "Blocked", summary: "Current weather" },
    spend: { available: false }, money: { available: false },
    fleetPlan: { fleetStars: [] }, notionMirror: { available: false }, skyFeed: { list: [] },
    timeline: { events: [{ id: "old", kind: "lock_claim", atMs: now - 600_000, atIso: new Date(now - 600_000).toISOString(), botId: "dashboard", label: "Claimed" }], earliestMs: now - 600_000, latestMs: now - 600_000, droppedFuture: 0, droppedInvalid: 0, truncated: false },
  };
  const react = {
    lazy: () => "LazyGraph", Suspense: "Suspense",
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo(fn: () => any) { cursor++; return fn(); },
    useCallback(fn: any) { cursor++; return fn; },
    useEffect(fn: () => void) { cursor++; effects.push(fn); },
  };
  const modules: Record<string, any> = {
    react,
    "react/jsx-runtime": { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }), Fragment: "Fragment" },
    "./use-workspace-graph": { useWorkspaceGraph: () => ({ scope: null, graph: null, summary: "", refresh() {} }) },
    "./use-dashboard-status": { useDashboardStatus: () => ({ state: { status: "ready", data }, refresh() {} }) },
    "./mobile-structure": { MobileChrome: "MobileChrome", MobilePanelCard: "MobilePanelCard", useMobilePanelFocus: () => ({ focused, setFocused(value: string | null) { focused = value; }, clear() { focused = null; } }) },
    "./operator-console": { OperatorConsole: "OperatorConsole", loadInitialOperatorPrefs: () => ({ layers: { sound: false, labels: true, charts: false, feed: true, time: true }, healthFilter: "all" }), useOperatorHotkey() {}, persistOperatorPrefs() {} },
    "@/lib/mind/dashboard/hud-order": { sortHudCards: (cards: any[]) => cards, hudDefaultOpen: () => false },
    "@/lib/mind/dashboard/telemetry-display": telemetry,
    "@/lib/mind/dashboard/graph-filters": { DEFAULT_GRAPH_FILTER, filterBotIds },
    "@/lib/mind/dashboard/view-state": { focusDashboardPanel },
    "@/lib/mind/dashboard/time-scrub": { applyScrubToBots, scrubAt },
    "@/lib/mind/dashboard/flyover-fsm": { FLY_HOME: { level: "universe" } },
    "@/lib/mind/dashboard/city-layout": { buildCityLayout: () => ({ buildings: [] }) },
    "./node-detail-panel": { NodeDetailPanel: "NodeDetailPanel", resolveNotionNeighbors: () => [] },
    "./graph-filters-panel": { GraphFiltersPanel: "GraphFiltersPanel" },
    "./time-scrubber": { TimeScrubber: "TimeScrubber" },
  };
  const exports: any = {};
  const document = { activeElement: null, getElementById: () => mounted ? { scrollIntoView: (opts: any) => scrolls.push(opts), focus: () => { focusedElement = true; } } : null };
  const compiled = ts.transpileModule(source("dashboard-app.tsx"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require: (name: string) => modules[name] ?? new Proxy({}, { get: (_o, key) => key }), Date, document, HTMLElement: class {}, window: { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) } });
  function render() { cursor = 0; effects = []; const tree = exports.DashboardApp({ embedded: true }); mounted = descendants(tree).some((node) => node.props["data-testid"] === "dash3d-panel-stack"); return descendants(tree); }
  return { render, effects: () => effects, data, now, scrolls, focused: () => focusedElement };
}

test("C2 AA008/009: fallback, search and selected details retain historical health and filters through retry", () => {
  const h = dashboardFixture();
  let nodes = h.render();
  nodes.find((n) => n.props["data-testid"] === "support-panels-toggle")!.props.onClick();
  nodes = h.render();
  nodes.find((n) => n.type === "TimeScrubber")!.props.onScrubMs(h.now - 590_000);
  nodes = h.render();
  const graph = nodes.find((n) => n.type === "LazyGraph")!;
  assert.equal(graph.props.data.bots[0].health, "healthy");
  graph.props.onUnavailable("Synthetic no WebGL");
  nodes = h.render();
  const fallback = nodes.find((n) => n.props["aria-label"] === "Operations list")!;
  const botButton = descendants(fallback).find((n) => n.type === "button" && descendants(n).some((child) => child.props.className === "dash3d-dot healthy"))!;
  assert.ok(botButton);
  botButton.props.onClick();
  nodes = h.render();
  const detail = nodes.find((n) => n.type === "NodeDetailPanel")!;
  assert.equal(detail.props.bot.health, "healthy");
  assert.match(detail.props.healthTimeLabel, /Historical health/);
  assert.equal(nodes.find((n) => n.type === "OperatorConsole")!.props.bots[0].health, "healthy");
  for (const id of ["zoom-in", "zoom-out", "zoom-sky"]) assert.equal(nodes.find((n) => n.props["data-testid"] === id)!.props.disabled, true);
  nodes.find((n) => n.type === "GraphFiltersPanel")!.props.onFilterChange({ ...DEFAULT_GRAPH_FILTER, health: "healthy" });
  nodes = h.render();
  nodes.find((n) => n.props["data-testid"] === "retry-3d")!.props.onClick();
  nodes = h.render();
  assert.equal(nodes.find((n) => n.type === "LazyGraph")!.props.filter.health, "healthy");
  assert.equal(nodes.find((n) => n.type === "NodeDetailPanel")!.props.bot.id, "dashboard");
  assert.equal(nodes.find((n) => n.props["data-testid"] === "zoom-in")!.props.disabled, false);
  nodes.find((n) => n.type === "TimeScrubber")!.props.onScrubMs(null);
  nodes = h.render();
  assert.equal(nodes.find((n) => n.type === "NodeDetailPanel")!.props.bot.health, "blocked");
});

test("C2 AA010: mobile navigation mounts support content before focus, including hidden-layer explanation", () => {
  const h = dashboardFixture();
  h.render();
  h.effects().find((effect) => String(effect).includes("(max-width: 720px)"))!();
  let nodes = h.render();
  assert.equal(nodes.some((n) => n.props["data-testid"] === "dash3d-panel-stack"), false);
  nodes.find((n) => n.type === "MobileChrome")!.props.onJump("charts");
  nodes = h.render();
  assert.equal(nodes.some((n) => n.props["data-testid"] === "dash3d-panel-stack"), true);
  const card = nodes.find((n) => n.type === "MobilePanelCard" && n.props.id === "charts")!;
  assert.equal(card.props.focused, "charts");
  assert.match(JSON.stringify(card), /Charts are hidden/);
  h.effects().find((effect) => String(effect).includes("focusDashboardPanel"))!();
  assert.equal(h.focused(), true);
  assert.equal(h.scrolls.length, 1);
});

test("C2 AA003/004: actual restore and preference callbacks wake a parked scene without resetting navigation", () => {
  const scene = source("universe-scene.tsx");
  const start = scene.indexOf("const detachContext = attachPainterlyContextHandlers");
  const end = scene.indexOf("\n\n    let last", start);
  assert.ok(start >= 0 && end > start);
  const queue: string[] = [];
  let restore: (() => void) | undefined;
  const restoreCode = stripTypeScriptTypes(scene.slice(start, end));
  const sandbox = { renderer: { domElement: {} }, kit: {}, layoutSig: "old", syncCity() { queue.push("sync"); }, arm(kind: string) { queue.push(kind); }, attachPainterlyContextHandlers(_canvas: unknown, _kit: unknown, cb: () => void) { restore = cb; } };
  runInNewContext(restoreCode, sandbox);
  restore!();
  assert.deepEqual(queue, ["sync", "data"]);
  assert.equal(sandbox.layoutSig, "");
  assert.doesNotMatch(scene, /\}, \[reducedMotion, onUnavailable\]\)/);
  const updateStart = scene.indexOf("    updatePreferencesRef.current = () => {");
  const updateEnd = scene.indexOf("\n\n    function setFly", updateStart);
  const nav = { level: "interior", buildingId: "project-a", floor: 2, camera: [1, 2, 3] };
  const ref: { current?: () => void } = {};
  const state = { updatePreferencesRef: ref, preferencesRef: { current: { reducedMotion: true, filter: DEFAULT_GRAPH_FILTER } }, reducedMotion: false, graphAllow: null, dataRef: { current: { bots: [], constellationEdges: [] } }, postfxRecovery: { lost: false, notifyRestored() { queue.push("postfx"); } }, kit: { contextLost: false }, ensureComposer() {}, filterBotIds, arm(kind: string) { queue.push(kind); }, nav };
  runInNewContext(stripTypeScriptTypes(scene.slice(updateStart, updateEnd)), state);
  ref.current!();
  assert.equal(state.reducedMotion, true);
  assert.deepEqual(nav, { level: "interior", buildingId: "project-a", floor: 2, camera: [1, 2, 3] });
  assert.equal(queue.at(-1), "render");
  state.preferencesRef.current.reducedMotion = false;
  ref.current!();
  assert.equal(state.reducedMotion, false);
});

test("mobile post-mount focus respects reduced motion and missing destinations", () => {
  const calls: unknown[] = [];
  const element = { scrollIntoView: (opts: unknown) => calls.push(opts), focus: (opts: unknown) => calls.push(opts) };
  assert.equal(focusDashboardPanel({ getElementById: () => null }, "money", true), false);
  assert.equal(focusDashboardPanel({ getElementById: () => element as unknown as HTMLElement }, "money", true), true);
  assert.deepEqual(calls, [{ behavior: "auto", block: "start" }, { preventScroll: true }]);
});

test("C2 AA009: graph recovery initializes from the current filter without an event rebroadcast", async () => {
  const text = source("fleet-force-graph.tsx");
  const helpers = text.slice(text.indexOf("const HEALTH_COLOR"), text.indexOf("export function FleetForceGraph"));
  const start = text.indexOf("  useEffect(() => {\n    const mount");
  const end = text.indexOf("  }, []);", start);
  assert.ok(start >= 0 && end > start);
  const effect = text.slice(start + "  useEffect(() => {".length, end).replace('await import("3d-force-graph")', "await importGraph()");
  let rendered: any;
  let fail = true;
  let destroys = 0;
  const graph: any = new Proxy({}, { get: (_target, name) => (...args: any[]) => {
    if (name === "graphData") { if (!args.length) return rendered; rendered = args[0]; }
    if (name === "_destructor") destroys++;
    return graph;
  } });
  const data = { bots: [{ id: "a", name: "Healthy", health: "healthy" }, { id: "b", name: "Blocked", health: "blocked" }], constellationEdges: [], notionGraph: { pages: [], edges: [], botPageMap: {} } };
  const errors: string[] = [];
  const state: any = {
    mountRef: { current: { clientWidth: 800, clientHeight: 600, replaceChildren() {} } }, graphRef: { current: null },
    dataRef: { current: data }, filterRef: { current: { ...DEFAULT_GRAPH_FILTER, health: "blocked" } }, motionRef: { current: false },
    callbacks: { current: { onUnavailable: (error: string) => errors.push(error), onSelectBot() {}, onSelectNotion() {}, onSkyView() {} } },
    highlighted: { current: new Set() }, hoverId: { current: null }, allowRef: { current: null },
    filterBotIds, sanitizeLabelText: (value: string) => value,
    document: new EventTarget(), window: { innerWidth: 800, innerHeight: 600 }, ResizeObserver: class { observe() {} disconnect() {} },
    importGraph: async () => ({ default: function Graph() { if (fail) throw new Error("Synthetic WebGL rejection"); return graph; } }),
  };
  runInNewContext(stripTypeScriptTypes(`${helpers}\nfunction mountEffect() {${effect}\n}\nglobalThis.cleanup = mountEffect();`), state);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(state.graphRef.current, null);
  state.cleanup();
  fail = false;
  runInNewContext("cleanup = mountEffect();", state);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(rendered.nodes, (node: any) => node.id), ["b"]);
  state.cleanup();
  assert.equal(destroys, 1);
});
