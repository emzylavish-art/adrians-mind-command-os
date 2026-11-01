import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { BotNode, DashboardStatus, Health } from "@/lib/mind/dashboard/types";
import { botWorldPosition } from "@/lib/mind/dashboard/constellations";
import { pageStarPositions } from "@/lib/mind/dashboard/notion-graph-core";
import {
  rebuildLandingPaths,
  rebuildQueueRoad,
  rebuildFleetLaneLines,
} from "./fleet-plan-layer";
import {
  createRig,
  dollyPose,
  flyTo,
  focusBotTarget,
  stepRig,
  zoomOutTarget,
  type CameraRigState,
  UNIVERSE_HOME,
} from "@/lib/mind/dashboard/camera-rig";

const HEALTH_COLOR: Record<Health, number> = {
  healthy: 0x3dd68c,
  stalled: 0xfbbf24,
  blocked: 0xff6b8a,
  idle: 0x5b6b8c,
};

type Props = {
  data: DashboardStatus;
  reducedMotion: boolean;
  onSelectBot: (bot: BotNode) => void;
  onSelectNotion: (pageId: string) => void;
  onSkyView: () => void;
  onUnavailable: (reason: string) => void;
};

const PainterlyShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i); float b = hash(i+vec2(1.,0.));
      float c = hash(i+vec2(0.,1.)); float d = hash(i+vec2(1.,1.));
      vec2 u = f*f*(3.-2.*f);
      return mix(a,b,u.x)+ (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
    }
    void main(){
      vec2 uv = vUv;
      float n = noise(uv * 90.0 + time * 0.05);
      vec2 off = (vec2(noise(uv*40.), noise(uv*40.+9.)) - 0.5) * amount * 0.012;
      vec4 c = texture2D(tDiffuse, uv + off);
      // mild kuwahara-ish quantization via neighbor average
      vec4 blur = (
        texture2D(tDiffuse, uv + vec2( off.x, 0.)) +
        texture2D(tDiffuse, uv + vec2(-off.x, 0.)) +
        texture2D(tDiffuse, uv + vec2(0.,  off.y)) +
        texture2D(tDiffuse, uv + vec2(0., -off.y))
      ) * 0.25;
      c.rgb = mix(c.rgb, blur.rgb, 0.35);
      // paper grain + edge darken
      float grain = (n - 0.5) * 0.08 * amount;
      c.rgb += grain;
      float vig = smoothstep(1.1, 0.35, length(uv - 0.5));
      c.rgb *= mix(0.82, 1.0, vig);
      gl_FragColor = c;
    }
  `,
};

function makeStarSpriteTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.85)");
  g.addColorStop(0.55, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,size,size);
  // brush ticks
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size/2, size/2);
    ctx.lineTo(size/2 + Math.cos(a)*size*0.42, size/2 + Math.sin(a)*size*0.42);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNebulaTexture(seed = 1) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#050814";
  ctx.fillRect(0,0,size,size);
  const rand = (n: number) => {
    const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 40; i++) {
    const x = rand(i) * size;
    const y = rand(i + 40) * size;
    const r = 40 + rand(i + 80) * 120;
    const hue = 220 + rand(i + 120) * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},70%,55%,0.28)`);
    g.addColorStop(0.5, `hsla(${hue + 30},60%,40%,0.12)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // paper grain
  const img = ctx.getImageData(0,0,size,size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand(i) - 0.5) * 18;
    img.data[i] = Math.min(255, Math.max(0, img.data[i]! + n));
    img.data[i+1] = Math.min(255, Math.max(0, img.data[i+1]! + n));
    img.data[i+2] = Math.min(255, Math.max(0, img.data[i+2]! + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePaintCardTexture(title: string, body: string, accent: string) {
  const w = 512, h = 288;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0c1224";
  ctx.fillRect(0,0,w,h);
  const g = ctx.createLinearGradient(0,0,w,h);
  g.addColorStop(0, "rgba(124,92,255,0.35)");
  g.addColorStop(1, "rgba(73,194,255,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(10,10,w-20,h-20);
  ctx.fillStyle = "#f3f5ff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(title.slice(0, 34), 28, 56);
  ctx.fillStyle = "#93a0c2";
  ctx.font = "18px sans-serif";
  const words = body.split(/\s+/);
  let line = "", y = 96;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > w - 56) {
      ctx.fillText(line, 28, y);
      line = word;
      y += 26;
      if (y > h - 36) break;
    } else line = test;
  }
  if (y <= h - 36) ctx.fillText(line, 28, y);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function UniverseScene({ data, reducedMotion, onSelectBot, onSelectNotion, onSkyView, onUnavailable }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef(data);
  const cbs = useRef({ onSelectBot, onSelectNotion, onSkyView });
  dataRef.current = data;
  cbs.current = { onSelectBot, onSelectNotion, onSkyView };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
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
    scene.fog = new THREE.FogExp2(0x050814, 0.018);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 200);
    camera.position.set(...UNIVERSE_HOME.position);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x050814, 1);
    mount.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);

    // Sky dome with painterly nebula
    const skyMat = new THREE.MeshBasicMaterial({
      map: makeNebulaTexture(3),
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 24), skyMat);
    scene.add(sky);

    scene.add(new THREE.AmbientLight(0x8ea0d0, 0.55));
    const sun = new THREE.PointLight(0xffe6a8, 90, 60);
    sun.position.set(0, 2, 0);
    scene.add(sun);
    const rim = new THREE.PointLight(0x7c5cff, 40, 50);
    rim.position.set(-8, 6, 10);
    scene.add(rim);

    const starTex = makeStarSpriteTexture();
    const botGroup = new THREE.Group();
    scene.add(botGroup);
    const edgeGroup = new THREE.Group();
    scene.add(edgeGroup);
    const cardGroup = new THREE.Group();
    scene.add(cardGroup);
    const pageGroup = new THREE.Group();
    scene.add(pageGroup);
    const landingGroup = new THREE.Group();
    scene.add(landingGroup);
    const queueGroup = new THREE.Group();
    scene.add(queueGroup);
    const fleetLineGroup = new THREE.Group();
    scene.add(fleetLineGroup);

    type BotVis = { id: string; mesh: THREE.Mesh; glow: THREE.Sprite; label: CSS2DObject; health: Health; base: THREE.Vector3 };
    const botVis: BotVis[] = [];
    const botMeshes: THREE.Mesh[] = [];
    const pageIdByIndex: string[] = [];

    const sphereGeo = new THREE.SphereGeometry(0.42, 28, 28);
    // Orchestrator sun
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 1.2, roughness: 0.4 }),
    );
    sunMesh.position.set(0, 1.2, 0);
    sunMesh.userData.botId = "grok-build";
    scene.add(sunMesh);

    function rebuildBots(list: BotNode[]) {
      while (botGroup.children.length) botGroup.remove(botGroup.children[0]!);
      botVis.length = 0;
      botMeshes.length = 0;
      for (const bot of list) {
        const posArr = botWorldPosition(bot.id);
        const pos = new THREE.Vector3(...posArr);
        if (bot.id === "grok-build") {
          sunMesh.position.copy(pos);
          const mat = sunMesh.material as THREE.MeshStandardMaterial;
          mat.emissive = new THREE.Color(HEALTH_COLOR[bot.health]);
          continue;
        }
        const color = HEALTH_COLOR[bot.health];
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: bot.health === "idle" ? 0.25 : 0.9,
          roughness: 0.35,
          metalness: 0.15,
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.position.copy(pos);
        mesh.userData.botId = bot.id;
        botGroup.add(mesh);
        botMeshes.push(mesh);

        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: starTex,
            color,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.scale.set(2.2, 2.2, 2.2);
        glow.position.copy(pos);
        botGroup.add(glow);

        const el = document.createElement("div");
        el.className = "dash3d-label";
        el.textContent = bot.name.replace(/ Bot$/, "").replace(" / Orchestrator", "");
        const label = new CSS2DObject(el);
        label.position.set(pos.x, pos.y + 0.75, pos.z);
        botGroup.add(label);

        botVis.push({ id: bot.id, mesh, glow, label, health: bot.health, base: pos.clone() });
      }
    }

    function rebuildEdges(status: DashboardStatus) {
      while (edgeGroup.children.length) {
        const ch = edgeGroup.children[0]!;
        edgeGroup.remove(ch);
        if (ch instanceof THREE.Line) {
          ch.geometry.dispose();
          (ch.material as THREE.Material).dispose();
        }
      }
      const posOf = (id: string) => {
        if (id === "grok-build") return sunMesh.position.clone();
        const v = botVis.find((b) => b.id === id);
        return v ? v.base.clone() : null;
      };
      for (const e of status.constellationEdges) {
        const a = posOf(e.from);
        const b = posOf(e.to);
        if (!a || !b) continue;
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const mat = new THREE.LineBasicMaterial({
          color: HEALTH_COLOR[e.health],
          transparent: true,
          opacity: e.kind === "hub" ? 0.35 : 0.55,
        });
        edgeGroup.add(new THREE.Line(geo, mat));
      }
    }

    function rebuildCards(status: DashboardStatus) {
      while (cardGroup.children.length) {
        const ch = cardGroup.children[0]!;
        cardGroup.remove(ch);
        if (ch instanceof THREE.Mesh) {
          (ch.material as THREE.MeshBasicMaterial).map?.dispose();
          (ch.material as THREE.Material).dispose();
          ch.geometry.dispose();
        }
      }
      const mk = (title: string, body: string, accent: string, pos: [number, number, number]) => {
        const tex = makePaintCardTexture(title, body, accent);
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(3.6, 2),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
        );
        mesh.position.set(...pos);
        mesh.lookAt(camera.position);
        cardGroup.add(mesh);
      };
      mk(
        `Weather · ${status.weather.label}`,
        status.weather.summary,
        status.weather.tone === "blocked" ? "#ff6b8a" : status.weather.tone === "stalled" ? "#fbbf24" : "#3dd68c",
        [-7.5, 5.5, -2],
      );
      mk(
        "Orchestrator",
        `${status.orchestrator.owner ?? "—"} · ${status.orchestrator.status ?? "—"} · ${status.orchestrator.branch ?? ""}`,
        "#7c5cff",
        [7.2, 5.2, -1.5],
      );
      const gaps = status.gapDispatcher.items.slice(0, 4).map((g) => `${g.rank ?? "·"} ${g.feature}`).join(" · ")
        || `source: ${status.gapDispatcher.source}`;
      mk("Gap Dispatcher", gaps, "#49c2ff", [0, -6.2, 4]);
      const commits = status.commits.slice(0, 3).map((c) => `${c.sha} ${c.subject}`).join(" · ") || "No commits";
      mk("Recent commits", commits, "#a78bfa", [-1, 6.5, 5]);
      const spend = status.spend.available ? "Live spend log on box" : status.spend.reason;
      mk("API spend", spend, "#93a0c2", [6, -3.5, 5]);
      const nudges = status.conductor.nudges.slice(0, 3).join(" · ") || `source: ${status.conductor.source}`;
      mk("Conductor", nudges, "#2dd4bf", [-6.5, -2.5, 5.5]);
    }

    // Notion page galaxy — instanced sprites for perf
    const pageGeo = new THREE.SphereGeometry(0.12, 8, 8);
    let pageMesh: THREE.InstancedMesh | null = null;

    function rebuildPages(status: DashboardStatus) {
      if (pageMesh) {
        pageGroup.remove(pageMesh);
        pageMesh.dispose();
        pageMesh = null;
      }
      pageIdByIndex.length = 0;
      const pages = status.notionGraph.pages;
      if (!pages.length) return;
      const positions = pageStarPositions(pages.length, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x9bb7ff,
        emissive: 0x4960a8,
        emissiveIntensity: 0.55,
        roughness: 0.5,
      });
      pageMesh = new THREE.InstancedMesh(pageGeo, mat, pages.length);
      const dummy = new THREE.Object3D();
      pages.forEach((p, i) => {
        pageIdByIndex[i] = p.id;
        const [x, y, z] = positions[i]!;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        pageMesh!.setMatrixAt(i, dummy.matrix);
      });
      pageMesh.instanceMatrix.needsUpdate = true;
      pageGroup.add(pageMesh);

      // parent/child edges (cap for perf)
      const idToPos = new Map<string, THREE.Vector3>();
      pages.forEach((p, i) => {
        const [x, y, z] = positions[i]!;
        idToPos.set(p.id, new THREE.Vector3(x, y, z));
      });
      let drawn = 0;
      for (const e of status.notionGraph.edges) {
        if (e.kind !== "child") continue;
        const a = idToPos.get(e.from);
        const b = idToPos.get(e.to);
        if (!a || !b) continue;
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        edgeGroup.add(
          new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({ color: 0x4a5d8c, transparent: true, opacity: 0.22 }),
          ),
        );
        if (++drawn > 80) break;
      }
    }

    // Lane nebula tints
    const nebulaGroup = new THREE.Group();
    scene.add(nebulaGroup);
    function rebuildNebulae(status: DashboardStatus) {
      while (nebulaGroup.children.length) {
        const ch = nebulaGroup.children[0]!;
        nebulaGroup.remove(ch);
        (ch as THREE.Mesh).geometry.dispose();
        ((ch as THREE.Mesh).material as THREE.Material).dispose();
      }
      for (const lane of status.constellations) {
        const color = HEALTH_COLOR[lane.health];
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: lane.health === "idle" ? 0.04 : 0.09,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 16), mat);
        mesh.position.set(...lane.center);
        nebulaGroup.add(mesh);
      }
    }

    function rebuildAll() {
      const status = dataRef.current;
      rebuildBots(status.bots);
      rebuildEdges(status);
      rebuildCards(status);
      rebuildPages(status);
      rebuildNebulae(status);
      if (status.fleetPlan) {
        rebuildLandingPaths(landingGroup, status.fleetPlan);
        rebuildQueueRoad(queueGroup, status.fleetPlan);
        rebuildFleetLaneLines(fleetLineGroup, status.fleetPlan, (id) => {
          if (id === "grok-build") return sunMesh.position.clone();
          const v = botVis.find((b) => b.id === id);
          return v ? v.base.clone() : null;
        });
      }
    }
    rebuildAll();

    let composer: EffectComposer | null = null;
    let paintPass: ShaderPass | null = null;
    if (!reducedMotion) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.62, 0.75, 0.22));
      paintPass = new ShaderPass(PainterlyShader);
      composer.addPass(paintPass);
    }

    let rig: CameraRigState = createRig();
    let lookAt = new THREE.Vector3(...UNIVERSE_HOME.lookAt);
    let freePos = new THREE.Vector3(...UNIVERSE_HOME.position);
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let spherical = new THREE.Spherical().setFromVector3(freePos.clone().sub(lookAt));

    const applyPose = (pos: [number, number, number], look: [number, number, number]) => {
      camera.position.set(...pos);
      lookAt.set(...look);
      camera.lookAt(lookAt);
      freePos.set(...pos);
      spherical.setFromVector3(freePos.clone().sub(lookAt));
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const next = dollyPose(
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
        ev.deltaY,
      );
      // If transitioning, cancel into free dolly
      freePos.set(...next);
      camera.position.copy(freePos);
      spherical.setFromVector3(freePos.clone().sub(lookAt));
      rig = { ...rig, t: 1, to: { position: next, lookAt: [lookAt.x, lookAt.y, lookAt.z] }, from: { position: next, lookAt: [lookAt.x, lookAt.y, lookAt.z] } };
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const onPointerDown = (ev: PointerEvent) => {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const onPointerUp = (ev: PointerEvent) => {
      const dx = Math.abs(ev.clientX - lastX);
      const dy = Math.abs(ev.clientY - lastY);
      const wasDrag = dx > 4 || dy > 4;
      dragging = false;
      if (wasDrag) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects([sunMesh, ...botMeshes], false);
      if (hits[0]) {
        const id = hits[0].object.userData.botId as string;
        const bot = dataRef.current.bots.find((b) => b.id === id);
        if (bot) {
          const pos = bot.id === "grok-build"
            ? [sunMesh.position.x, sunMesh.position.y, sunMesh.position.z] as [number, number, number]
            : botWorldPosition(bot.id);
          const target = focusBotTarget(pos, bot.id, rig.level === "interior" ? "interior" : "universe");
          rig = flyTo(
            rig,
            target,
            [camera.position.x, camera.position.y, camera.position.z],
            [lookAt.x, lookAt.y, lookAt.z],
          );
          cbs.current.onSelectBot(bot);
          return;
        }
      }

      if (pageMesh) {
        const pageHits = raycaster.intersectObject(pageMesh, false);
        if (pageHits[0] && pageHits[0].instanceId != null) {
          const pid = pageIdByIndex[pageHits[0].instanceId];
          if (pid) {
            cbs.current.onSelectNotion(pid);
            return;
          }
        }
      }

      // empty space -> sky view
      const up = zoomOutTarget(rig.level);
      rig = flyTo(
        rig,
        up,
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
      );
      cbs.current.onSkyView();
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging || rig.t < 1) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      spherical.theta -= dx * 0.005;
      spherical.phi = Math.min(Math.PI * 0.45, Math.max(0.12, spherical.phi + dy * 0.005));
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      freePos.copy(lookAt).add(offset);
      camera.position.copy(freePos);
      camera.lookAt(lookAt);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", () => { dragging = false; });

    let last = performance.now();
    let raf = 0;
    let sync = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (rig.t < 1) {
        const stepped = stepRig(rig, reducedMotion ? 10 : dt, reducedMotion ? 0.01 : 1.15);
        rig = stepped.rig;
        applyPose(stepped.position, stepped.lookAt);
      }

      // billboard cards
      for (const ch of cardGroup.children) {
        ch.lookAt(camera.position);
      }

      if (!reducedMotion) {
        const t = now * 0.001;
        for (const n of botVis) {
          if (n.health === "idle") continue;
          const speed = n.health === "stalled" ? 1.1 : n.health === "blocked" ? 3.2 : 2.2;
          const pulse = 1 + Math.sin(t * speed + n.base.x) * (n.health === "stalled" ? 0.05 : 0.1);
          n.mesh.scale.setScalar(pulse);
          n.glow.scale.setScalar(2.0 + Math.sin(t * speed) * 0.3);
        }
        sun.intensity = 80 + Math.sin(t * 1.5) * 12;
        if (paintPass) paintPass.uniforms.time.value = t;
      }

      if (composer) composer.render();
      else renderer.render(scene, camera);
      labelRenderer.render(scene, camera);

      if (now - sync > 5000) {
        sync = now;
        rebuildAll();
      }
    };
    tick(performance.now());

    const onResize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      composer?.setSize(w, h);
    };
    
    const onSkyEvent = () => {
      const up = zoomOutTarget(rig.level);
      rig = flyTo(
        rig,
        up,
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
      );
      cbs.current.onSkyView();
    };
    document.addEventListener("dash3d-sky", onSkyEvent);

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("dash3d-sky", onSkyEvent);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(raf);
      sphereGeo.dispose();
      pageGeo.dispose();
      starTex.dispose();
      skyMat.map?.dispose();
      skyMat.dispose();
      renderer.dispose();
      composer?.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentElement === mount) mount.removeChild(labelRenderer.domElement);
    };
  }, [reducedMotion, onUnavailable]);

  return <div className="dash3d-canvas-wrap" ref={mountRef} />;
}
