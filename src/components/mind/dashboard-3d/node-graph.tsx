import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { BotNode, Health } from "@/lib/mind/dashboard/types";

const HEALTH_COLOR: Record<Health, number> = {
  healthy: 0x3dd68c,
  stalled: 0xfbbf24,
  blocked: 0xff6b8a,
  idle: 0x5b6b8c,
};

type GraphProps = {
  bots: BotNode[];
  reducedMotion: boolean;
  onSelect: (bot: BotNode) => void;
  onUnavailable: (reason: string) => void;
};

function layoutPosition(index: number, total: number, hub = false): THREE.Vector3 {
  if (hub) return new THREE.Vector3(0, 0.4, 0);
  const ring = 1 + Math.floor(index / 8);
  const inRing = index % Math.max(total, 1);
  const count = Math.min(8, total);
  const angle = (inRing / count) * Math.PI * 2 - Math.PI / 2;
  const radius = 4.2 * ring;
  return new THREE.Vector3(Math.cos(angle) * radius, (index % 3) * 0.35 - 0.35, Math.sin(angle) * radius);
}

export function NodeGraph({ bots, reducedMotion, onSelect, onUnavailable }: GraphProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const botsRef = useRef(bots);
  const selectRef = useRef(onSelect);
  botsRef.current = bots;
  selectRef.current = onSelect;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) {
        onUnavailable("WebGL is not available in this browser.");
        return;
      }
    } catch {
      onUnavailable("WebGL probe failed.");
      return;
    }

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070b16, 0.045);
    scene.background = new THREE.Color(0x070b16);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    camera.position.set(0, 7.5, 12);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 4;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x8ea0d0, 0.55));
    const key = new THREE.PointLight(0x7c5cff, 60, 40);
    key.position.set(4, 8, 6);
    scene.add(key);
    const fill = new THREE.PointLight(0x49c2ff, 30, 40);
    fill.position.set(-6, 4, -4);
    scene.add(fill);

    const grid = new THREE.GridHelper(30, 30, 0x2a3354, 0x171e36);
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    const edgeGroup = new THREE.Group();
    scene.add(edgeGroup);

    type NodeObj = {
      id: string;
      mesh: THREE.Mesh;
      glow: THREE.Sprite;
      label: CSS2DObject;
      health: Health;
      baseY: number;
    };
    const nodeObjs: NodeObj[] = [];
    const meshById = new Map<string, THREE.Mesh>();

    const sphereGeo = new THREE.SphereGeometry(0.38, 32, 32);
    const spriteMat = makeGlowSprite();

    function rebuild(list: BotNode[]) {
      while (nodeGroup.children.length) {
        const child = nodeGroup.children[0]!;
        nodeGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          // geometry shared
        }
      }
      while (edgeGroup.children.length) {
        const child = edgeGroup.children[0]!;
        edgeGroup.remove(child);
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
      nodeObjs.length = 0;
      meshById.clear();

      const hubs = list.filter((b) => b.id === "grok-build" || b.id === "conductor");
      const lanes = list.filter((b) => b.id !== "grok-build" && b.id !== "conductor");

      const place = (bot: BotNode, index: number, hub: boolean) => {
        const color = HEALTH_COLOR[bot.health];
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: bot.health === "idle" ? 0.25 : 0.85,
          roughness: 0.35,
          metalness: 0.2,
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        const pos = layoutPosition(index, Math.max(lanes.length, 1), hub);
        if (bot.id === "conductor") pos.set(-1.6, 0.6, 0.2);
        if (bot.id === "grok-build") pos.set(1.4, 0.85, -0.2);
        if (bot.id === "dashboard") pos.set(0, -1.8, 0);
        mesh.position.copy(pos);
        mesh.userData.botId = bot.id;
        nodeGroup.add(mesh);
        meshById.set(bot.id, mesh);

        const glow = new THREE.Sprite(spriteMat.clone());
        glow.material.color = new THREE.Color(color);
        glow.scale.set(1.8, 1.8, 1.8);
        glow.position.copy(pos);
        nodeGroup.add(glow);

        const el = document.createElement("div");
        el.className = "dash3d-label";
        el.textContent = bot.name.replace(/ Bot$/, "").replace(" / Orchestrator", "");
        const label = new CSS2DObject(el);
        label.position.set(pos.x, pos.y + 0.65, pos.z);
        nodeGroup.add(label);

        nodeObjs.push({
          id: bot.id,
          mesh,
          glow,
          label,
          health: bot.health,
          baseY: pos.y,
        });
      };

      hubs.forEach((b, i) => place(b, i, true));
      lanes.forEach((b, i) => place(b, i, false));

      const orch = meshById.get("grok-build");
      const cond = meshById.get("conductor");
      for (const bot of lanes) {
        const target = meshById.get(bot.id);
        if (!target) continue;
        const from = orch ?? cond;
        if (from) addEdge(edgeGroup, from.position, target.position, bot.health);
      }
      if (orch && cond) addEdge(edgeGroup, orch.position, cond.position, "healthy");
    }

    rebuild(botsRef.current);

    let composer: EffectComposer | null = null;
    if (!reducedMotion) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.7, 0.25);
      composer.addPass(bloom);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeObjs.map((n) => n.mesh), false);
      const id = hits[0]?.object.userData.botId as string | undefined;
      if (!id) return;
      const bot = botsRef.current.find((b) => b.id === id);
      if (bot) selectRef.current(bot);
    };
    renderer.domElement.addEventListener("pointerdown", onPointer);

    let frame = 0;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      frame += 1;
      controls.update();
      if (!reducedMotion) {
        const t = performance.now() * 0.001;
        for (const n of nodeObjs) {
          if (n.health === "idle") continue;
          const pulse = 1 + Math.sin(t * 2.4 + n.baseY) * 0.08;
          n.mesh.scale.setScalar(pulse);
          const g = 1.6 + Math.sin(t * 2.4 + n.baseY) * 0.25;
          n.glow.scale.set(g, g, g);
          const mat = n.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = (n.health === "blocked" ? 0.95 : 0.7) + Math.sin(t * 3 + n.baseY) * 0.2;
        }
      }
      if (composer) composer.render();
      else renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      composer?.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const syncId = window.setInterval(() => {
      rebuild(botsRef.current);
    }, 5000);

    return () => {
      window.clearInterval(syncId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointer);
      cancelAnimationFrame(raf);
      controls.dispose();
      sphereGeo.dispose();
      spriteMat.dispose();
      renderer.dispose();
      composer?.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentElement === mount) mount.removeChild(labelRenderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, onUnavailable]);

  // health/color updates happen via interval rebuild inside effect

  return <div className="dash3d-canvas-wrap" ref={mountRef} />;
}

function addEdge(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, health: Health) {
  const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
  const mat = new THREE.LineBasicMaterial({
    color: HEALTH_COLOR[health],
    transparent: true,
    opacity: health === "idle" ? 0.2 : 0.45,
  });
  group.add(new THREE.Line(geo, mat));
}

function makeGlowSprite() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
