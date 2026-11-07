/**
 * Fleet force graph adapted from Hananoshika Yomaru's Obsidian 3D Graph
 * (MIT), which uses vasturiano/3d-force-graph for spatial exploration,
 * neighbour highlighting, degree-scaled nodes, camera focus, and filterable
 * global graphs. Obsidian APIs are not used; this host binds Adrian's Mind
 * dashboard status (bots + constellation edges + Notion pages).
 */
import { useEffect, useMemo, useRef } from "react";
// The published package exports a factory; default import shape varies by bundler.
import ForceGraph3D from "3d-force-graph";
import type { BotNode, DashboardStatus, Health } from "@/lib/mind/dashboard/types";
import { filterBotIds, type GraphFilterState } from "@/lib/mind/dashboard/graph-filters";
import { sanitizeLabelText } from "@/lib/mind/dashboard/health";

const HEALTH_COLOR: Record<Health, string> = {
  healthy: "#3dd68c",
  stalled: "#d6b77a",
  blocked: "#ff6b7a",
  idle: "#687487",
};

type GraphNode = {
  id: string;
  name: string;
  health: Health;
  kind: "bot" | "notion";
  val: number;
  bot?: BotNode;
  x?: number;
  y?: number;
  z?: number;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: string;
};

type GraphApi = {
  backgroundColor: (c: string) => GraphApi;
  showNavInfo: (v: boolean) => GraphApi;
  nodeId: (k: string) => GraphApi;
  nodeLabel: (fn: (n: GraphNode) => string) => GraphApi;
  nodeVal: (fn: (n: GraphNode) => number) => GraphApi;
  nodeOpacity: (n: number) => GraphApi;
  nodeColor: (fn?: (n: GraphNode) => string) => GraphApi;
  linkColor: (fn?: (l: GraphLink) => string) => GraphApi;
  linkWidth: (fn?: (l: GraphLink) => number) => GraphApi;
  linkDirectionalParticles: (fn?: (l: GraphLink) => number) => GraphApi;
  linkDirectionalParticleWidth: (n: number) => GraphApi;
  linkDirectionalArrowLength: (n: number) => GraphApi;
  linkDirectionalArrowRelPos: (n: number) => GraphApi;
  nodeRelSize: (n: number) => GraphApi;
  graphData: (g?: { nodes: GraphNode[]; links: GraphLink[] }) => GraphApi | { nodes: GraphNode[]; links: GraphLink[] };
  onNodeHover: (fn: (node: GraphNode | null) => void) => GraphApi;
  onNodeClick: (fn: (node: GraphNode, event: MouseEvent) => void) => GraphApi;
  cooldownTicks: (n: number) => GraphApi;
  d3AlphaDecay: (n: number) => GraphApi;
  d3VelocityDecay: (n: number) => GraphApi;
  width: (n: number) => GraphApi;
  height: (n: number) => GraphApi;
  cameraPosition: (
    pos: { x: number; y: number; z: number },
    lookAt: { x: number; y: number; z: number },
    ms: number,
  ) => GraphApi;
  _destructor: () => void;
};

type Props = {
  data: DashboardStatus;
  reducedMotion: boolean;
  onSelectBot: (bot: BotNode) => void;
  onSelectNotion: (pageId: string) => void;
  onSkyView: () => void;
  onUnavailable: (reason: string) => void;
};

function nodeIdOf(ref: string | GraphNode | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function buildGraph(data: DashboardStatus, allow: Set<string> | null) {
  const bots = data.bots.filter((b) => !allow || allow.has(b.id));
  const edges = (data.constellationEdges ?? []).filter(
    (e) => (!allow || allow.has(e.from)) && (!allow || allow.has(e.to)),
  );
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const nodes: GraphNode[] = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    health: bot.health,
    kind: "bot",
    val: 1 + (degree.get(bot.id) ?? 0),
    bot,
  }));
  const pages = (data.notionGraph?.pages ?? []).slice(0, 48);
  for (const page of pages) {
    nodes.push({
      id: `notion:${page.id}`,
      name: page.title || page.id,
      health: "idle",
      kind: "notion",
      val: 1,
    });
  }
  const links: GraphLink[] = edges.map((e) => ({
    source: e.from,
    target: e.to,
    kind: e.kind,
  }));
  for (const [botId, pageId] of Object.entries(data.notionGraph?.botPageMap ?? {})) {
    if (bots.some((b) => b.id === botId) && pages.some((p) => p.id === pageId)) {
      links.push({ source: botId, target: `notion:${pageId}`, kind: "notion" });
    }
  }
  return { nodes, links };
}

function createGraph(el: HTMLElement): GraphApi {
  const factory = ForceGraph3D as unknown as (opts?: { controlType?: string }) => (dom: HTMLElement) => GraphApi;
  return factory({ controlType: "orbit" })(el);
}

export function FleetForceGraph({
  data,
  reducedMotion,
  onSelectBot,
  onSelectNotion,
  onSkyView,
  onUnavailable,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<GraphApi | null>(null);
  const highlighted = useRef<Set<string>>(new Set());
  const hoverId = useRef<string | null>(null);
  const allowRef = useRef<Set<string> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const callbacks = useRef({ onSelectBot, onSelectNotion, onSkyView, onUnavailable });
  callbacks.current = { onSelectBot, onSelectNotion, onSkyView, onUnavailable };

  const initialGraph = useMemo(() => buildGraph(data, null), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let graph: GraphApi;
    try {
      graph = createGraph(mount)
        .backgroundColor("#05070d")
        .showNavInfo(false)
        .nodeId("id")
        .nodeLabel((n) => sanitizeLabelText(n.name))
        .nodeVal((n) => n.val)
        .nodeOpacity(0.92)
        .nodeColor((n) => {
          const hot = hoverId.current === n.id || highlighted.current.has(n.id);
          if (n.kind === "notion") return hot ? "#78a6d8" : "#3a4a63";
          const base = HEALTH_COLOR[n.health] ?? "#687487";
          if (highlighted.current.size && !hot) return "#243044";
          return base;
        })
        .linkColor((l) => {
          const s = nodeIdOf(l.source);
          const t = nodeIdOf(l.target);
          const hot =
            (s && highlighted.current.has(s)) ||
            (t && highlighted.current.has(t)) ||
            hoverId.current === s ||
            hoverId.current === t;
          if (highlighted.current.size && !hot) return "rgba(36,48,68,0.25)";
          if (l.kind === "lane") return hot ? "#78a6d8" : "rgba(120,166,216,0.35)";
          if (l.kind === "notion") return hot ? "#9aa3b5" : "rgba(154,163,181,0.28)";
          return hot ? "#f4f6fb" : "rgba(244,246,251,0.22)";
        })
        .linkWidth((l) => {
          const s = nodeIdOf(l.source);
          const t = nodeIdOf(l.target);
          const hot =
            (s && highlighted.current.has(s)) ||
            (t && highlighted.current.has(t)) ||
            hoverId.current === s ||
            hoverId.current === t;
          return hot ? 1.6 : 0.7;
        })
        .linkDirectionalParticles((l) => {
          const s = nodeIdOf(l.source);
          const t = nodeIdOf(l.target);
          const hot =
            (s && highlighted.current.has(s)) ||
            (t && highlighted.current.has(t)) ||
            hoverId.current === s ||
            hoverId.current === t;
          return hot && !reducedMotion ? 2 : 0;
        })
        .linkDirectionalParticleWidth(1.2)
        .linkDirectionalArrowLength(3.2)
        .linkDirectionalArrowRelPos(1)
        .nodeRelSize(4.2)
        .graphData(initialGraph)
        .onNodeHover((node) => {
          highlighted.current.clear();
          hoverId.current = node?.id ?? null;
          if (node) {
            highlighted.current.add(node.id);
            const g = graph.graphData() as { links: GraphLink[] };
            for (const link of g.links) {
              const s = nodeIdOf(link.source);
              const t = nodeIdOf(link.target);
              if (s === node.id || t === node.id) {
                if (s) highlighted.current.add(s);
                if (t) highlighted.current.add(t);
              }
            }
          }
          graph
            .nodeColor(graph.nodeColor() as unknown as (n: GraphNode) => string)
            .linkColor(graph.linkColor() as unknown as (l: GraphLink) => string)
            .linkWidth(graph.linkWidth() as unknown as (l: GraphLink) => number)
            .linkDirectionalParticles(
              graph.linkDirectionalParticles() as unknown as (l: GraphLink) => number,
            );
        })
        .onNodeClick((node, event) => {
          if (!node) return;
          if (event.ctrlKey || event.metaKey) {
            const distance = 90;
            const hx = node.x || 0.001;
            const hy = node.y || 0.001;
            const hz = node.z || 0.001;
            const distRatio = 1 + distance / Math.hypot(hx, hy, hz);
            graph.cameraPosition(
              { x: hx * distRatio, y: hy * distRatio, z: hz * distRatio },
              { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
              reducedMotion ? 0 : 900,
            );
          }
          if (node.kind === "bot" && node.bot) callbacks.current.onSelectBot(node.bot);
          if (node.kind === "notion") callbacks.current.onSelectNotion(node.id.replace(/^notion:/, ""));
        })
        .cooldownTicks(reducedMotion ? 0 : 90)
        .d3AlphaDecay(reducedMotion ? 1 : 0.022)
        .d3VelocityDecay(0.35);
    } catch (err) {
      callbacks.current.onUnavailable(err instanceof Error ? err.message : "WebGL graph failed to start");
      return;
    }

    graphRef.current = graph;
    const resize = () => {
      const w = Math.max(1, mount.clientWidth || window.innerWidth);
      const h = Math.max(1, mount.clientHeight || window.innerHeight);
      graph.width(w).height(h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const focusNode = (node: GraphNode) => {
      const distance = 90;
      const hx = node.x || 0.001;
      const hy = node.y || 0.001;
      const hz = node.z || 0.001;
      const distRatio = 1 + distance / Math.hypot(hx, hy, hz);
      graph.cameraPosition(
        { x: hx * distRatio, y: hy * distRatio, z: hz * distRatio },
        { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
        reducedMotion ? 0 : 900,
      );
    };

    const onFocusBot = (ev: Event) => {
      const botId = (ev as CustomEvent<{ botId?: string }>).detail?.botId;
      if (!botId || !graphRef.current) return;
      const g = graphRef.current.graphData() as { nodes: GraphNode[] };
      const node = g.nodes.find((n) => n.id === botId);
      if (!node) return;
      focusNode(node);
      if (node.bot) callbacks.current.onSelectBot(node.bot);
    };
    const onSky = () => {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: 280 }, { x: 0, y: 0, z: 0 }, reducedMotion ? 0 : 1100);
      callbacks.current.onSkyView();
    };
    const onFilter = (ev: Event) => {
      const detail = (ev as CustomEvent<GraphFilterState>).detail;
      if (!detail || !graphRef.current) return;
      const status = dataRef.current;
      allowRef.current = filterBotIds(status.bots, status.constellationEdges ?? [], detail);
      graphRef.current.graphData(buildGraph(status, allowRef.current));
    };
    document.addEventListener("dash3d-focus-bot", onFocusBot);
    document.addEventListener("dash3d-sky", onSky);
    document.addEventListener("dash3d-graph-filter", onFilter);

    return () => {
      document.removeEventListener("dash3d-focus-bot", onFocusBot);
      document.removeEventListener("dash3d-sky", onSky);
      document.removeEventListener("dash3d-graph-filter", onFilter);
      ro.disconnect();
      try {
        graph._destructor();
      } catch {
        /* ignore */
      }
      graphRef.current = null;
      mount.replaceChildren();
    };
  }, [initialGraph, reducedMotion]);

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.graphData(buildGraph(data, allowRef.current));
    if (reducedMotion) graphRef.current.cooldownTicks(0).d3AlphaDecay(1);
  }, [data, reducedMotion]);

  return (
    <div
      ref={mountRef}
      className="dash3d-canvas-wrap dash3d-force-host"
      data-testid="dash3d-force-host"
      aria-label="Fleet 3D force graph"
    />
  );
}
