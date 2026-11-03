import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { FeedEvent } from "@/lib/mind/dashboard/sky-feed";
import { feedPulseSpeedMul, feedSeverity } from "@/lib/mind/dashboard/feed-severity";
import { botWorldPosition } from "@/lib/mind/dashboard/constellations";
import type { DashboardBotId } from "@/lib/mind/dashboard/types";

export type FeedGlyphsHandle = {
  group: THREE.Group;
  update: (tSeconds: number, reducedMotion: boolean) => void;
  dispose: () => void;
  count: number;
};

type GlyphNode = {
  obj: CSS2DObject;
  el: HTMLDivElement;
  phase: number;
  speed: number;
  radius: number;
  yBase: number;
  life: number; // 0..1 fade cycle
  botId: DashboardBotId | null;
  pulseMul: number;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Painted glowing glyph sprites that drift and fade; click → dash3d-focus-bot. */
export function createFeedGlyphs(scene: THREE.Scene, events: readonly FeedEvent[]): FeedGlyphsHandle {
  const group = new THREE.Group();
  group.name = "feed-glyphs";
  scene.add(group);
  const nodes: GlyphNode[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const el = document.createElement("div");
    el.className = "dash3d-feed-glyph";
    el.dataset.kind = ev.kind;
    el.dataset.testid = "feed-glyph";
    el.title = ev.text;
    el.setAttribute("role", "button");
    el.tabIndex = -1; // Gap#14: out of tab order; Feed panel is the keyboard path
    const mark = document.createElement("span");
    mark.className = "dash3d-feed-glyph-mark";
    mark.textContent = ev.glyph;
    const label = document.createElement("span");
    label.className = "dash3d-feed-glyph-text";
    label.textContent = ev.text.slice(0, 42);
    el.appendChild(mark);
    el.appendChild(label);

    const botId = ev.botId;
    const focus = () => {
      if (!botId) return;
      document.dispatchEvent(
        new CustomEvent("dash3d-focus-bot", { detail: { botId } }),
      );
    };
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      focus();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focus();
      }
    });

    const obj = new CSS2DObject(el);
    const h = hash(ev.id);
    const home = botId
      ? botWorldPosition(botId)
      : ([
          Math.sin(h * Math.PI * 2) * 6,
          1.2 + (h * 2 - 1) * 1.5,
          Math.cos(h * Math.PI * 2) * 6,
        ] as [number, number, number]);
    obj.position.set(home[0], home[1] + 1.1 + (h - 0.5) * 0.8, home[2]);
    obj.userData.home = obj.position.clone();
    group.add(obj);
    const severity = feedSeverity(ev.kind, ev.text);
    el.dataset.severity = severity;
    if (severity === "alert") el.classList.add("is-alert");
    nodes.push({
      obj,
      el,
      phase: h * Math.PI * 2,
      speed: 0.12 + h * 0.25,
      radius: 0.35 + h * 0.55,
      yBase: obj.position.y,
      life: h,
      botId,
      pulseMul: feedPulseSpeedMul(severity),
    });
  }

  let disposed = false;
  return {
    group,
    count: nodes.length,
    update(tSeconds, reducedMotion) {
      if (disposed) return;
      for (const n of nodes) {
        if (reducedMotion) {
          n.el.style.opacity = "0.85";
          continue;
        }
        const ang = n.phase + tSeconds * n.speed;
        const ox = Math.cos(ang) * n.radius;
        const oz = Math.sin(ang) * n.radius * 0.7;
        // Drift around home (obj.position was set to home; store home via current-ox)
        // Recompute from phase only — use userData home if needed
        const home = n.obj.userData.home as THREE.Vector3 | undefined;
        if (!home) {
          n.obj.userData.home = n.obj.position.clone();
        }
        const base = (n.obj.userData.home as THREE.Vector3) ?? n.obj.position;
        n.obj.position.set(base.x + ox, n.yBase + Math.sin(ang * 1.3) * 0.25, base.z + oz);
        // Fade pulse 0.35..1
        const fade = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tSeconds * 0.7 * n.pulseMul + n.life * 6));
        n.el.style.opacity = String(fade);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (group.children.length) {
        group.remove(group.children[0]!);
      }
      scene.remove(group);
      nodes.length = 0;
    },
  };
}
