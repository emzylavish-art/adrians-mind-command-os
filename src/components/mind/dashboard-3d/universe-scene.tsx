import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { evaluatePerfBudget, nextEmaFrameMs } from "@/lib/mind/dashboard/perf-budget";
import { filterEdgeRecsByVisibility } from "@/lib/mind/dashboard/edge-visibility";
import { DEFAULT_GRAPH_FILTER, filterBotIds, type GraphFilterState } from "@/lib/mind/dashboard/graph-filters";
import { nhopBotIds } from "@/lib/mind/dashboard/nhop";
import {
  captureCanvasFrame,
  hideLastFrameFreeze,
  showLastFrameFreeze,
} from "@/lib/mind/dashboard/last-frame-freeze";
import {
  createPainterlyKit,
  tickPainterlyKit,
  disposePainterlyKit,
  attachPainterlyContextHandlers,
  setImagineNodeMap,
  createLoreTextAtlas,
  setLorePlaqueTextAtlas,
  releasePainterlyMaterial,
  type PainterlyKit,
} from "./materials";
import { createHealthAtmosphere, deriveFleetTone, type HealthAtmosphereHandle } from "./atmosphere";
import { createTunedBloomPass, createColorGradePass, createGodRayPass, createExposureRide, createContextLossRecovery } from "./postfx";
import { sanitizeLabelText } from "@/lib/mind/dashboard/health";
import type { BotNode, DashboardStatus, Health } from "@/lib/mind/dashboard/types";
import { botWorldPosition } from "@/lib/mind/dashboard/constellations";
import { pageStarPositions } from "@/lib/mind/dashboard/notion-graph-core";
import {
  rebuildLandingPaths,
  rebuildQueueRoad,
  rebuildFleetLaneLines,
} from "./fleet-plan-layer";
import {
  acceptFlyDispatch,
  acceptPointerPick,
  createRig,
  dollyPose,
  flyTo,
  focusBotTarget,
  stepRigSmooth,
  type CameraRigState,
} from "@/lib/mind/dashboard/camera-rig";
import {
  lineFlowPhase,
  samplePolylineTravel,
  travelProgress,
} from "@/lib/mind/dashboard/sky-flow";
import {
  pulsePhaseFromId,
  sampleOrbitDrift,
  sampleStarPulse,
  sanitizeDt,
  sharedMotionClock,
  createFocusEaseState,
  stepFocusEase,
  applyFocusPulse,
  applyFocusDrift,
  type FocusEaseState,
  createMotionPoseBag,
  captureFocusPose,
  restoreFocusPose,
  createFocusPoseHold,
  sanitizeMotionPoseBag,
  createHoverTooltipState,
  createHoverTooltipSample,
  setHoverTooltipTarget,
  stepHoverTooltip,
  createEdgePulseState,
  createEdgePulseSample,
  stepEdgePulseSync,
  createTravelerEaseState,
  createTravelerEaseSample,
  stepTravelerEase,
  pauseTraveler,
  resumeTraveler,
  type TravelerEaseState,
  type TravelerEaseSample,
} from "./motion";
import { isDocumentHidden } from "./particles/motion-lod";
import { createCommitComets, createDustField } from "./particles";
import { createFeedGlyphs } from "./feed-glyphs";
import { createCityLayer } from "./city/city-layer";
import { buildCityLayout, type CityLayout } from "@/lib/mind/dashboard/city-layout";
import {
  FLY_HOME,
  UNIVERSE_HIGH,
  clampCityPan,
  dollyLimits,
  reconcileFlyover,
  reduceFlyover,
  targetForState,
  type FlyEvent,
  type FlyState,
} from "@/lib/mind/dashboard/flyover-fsm";

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
  onFlyoverChange?: (state: FlyState, layout: CityLayout) => void;
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

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Motion c9 — survive UniverseScene remount / pan context-loss without easing snap. */
const motionPoseBag = createMotionPoseBag();

export function UniverseScene({ data, reducedMotion, onSelectBot, onSelectNotion, onSkyView, onUnavailable, onFlyoverChange }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef(data);
  const cbs = useRef({ onSelectBot, onSelectNotion, onSkyView, onFlyoverChange });
  dataRef.current = data;
  cbs.current = { onSelectBot, onSelectNotion, onSkyView, onFlyoverChange };

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
    // Flyover: start high above the universe with every constellation in view.
    camera.position.set(...UNIVERSE_HIGH.position);
    camera.lookAt(...UNIVERSE_HIGH.lookAt);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x050814, 1);
    const maxTexSize = renderer.capabilities.maxTextureSize || 2048;

    mount.appendChild(renderer.domElement);
    // Gap#3: keep prior freeze visible until first successful frame after (re)mount.
    let freezePendingClear = true;


    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);

    // Sky dome with painterly nebula
    const kit: PainterlyKit = createPainterlyKit({ pass: { amount: 0.42 } });
    let atm: HealthAtmosphereHandle | null = null;
    try {
      atm = createHealthAtmosphere(scene, { attachFog: false, tone: "idle" });
    } catch {
      atm = null;
    }
    // Ambient/key/rim owned by Light atmosphere when available; keep sun mesh light separate.
    if (!atm) {
      scene.add(new THREE.AmbientLight(0x8ea0d0, 0.55));
    }
    const sun = new THREE.PointLight(0xffe6a8, 90, 60);
    sun.position.set(0, 2, 0);
    scene.add(sun);
    const rim = new THREE.PointLight(0x7c5cff, 40, 50);
    rim.position.set(-8, 6, 10);
    if (!atm) scene.add(rim);

    const skyMat = kit.createSkyMaterial({ seed: 3 });
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 24), skyMat);
    scene.add(sky);
    // Painted backdrop (Grok Imagine) — honest fallback keeps procedural sky if missing
    const loader = new THREE.TextureLoader();
    loader.load(
      "/dashboard-3d/art/backdrop-nebula.webp",
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const painted = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false });
        sky.material = painted;
        skyMat.dispose();
      },
      undefined,
      () => { /* keep procedural sky — no source */ },
    );



    const starTex = kit.starSpriteTexture;
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

    type BotVis = { id: string; mesh: THREE.Mesh; glow: THREE.Sprite; label: CSS2DObject; health: Health; base: THREE.Vector3; setColor?: (color: THREE.ColorRepresentation, emissiveIntensity?: number) => void };
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

    const MAX_SCENE_BOTS = 48; // Gap#11: hard cap so a spiked payload cannot kill the tab
    const PORTRAIT_FALLBACK = "/dashboard-3d/art/portrait-dashboard.webp";
    let fallbackPortraitTex: THREE.Texture | null = null;
    const focusEase = new Map<string, FocusEaseState>();
    sanitizeMotionPoseBag(motionPoseBag);

    let pendingFocusBotId: string | null = null;

    function disposeBotMaterial(mat: THREE.Material) {
      if ((mat as THREE.ShaderMaterial).isShaderMaterial) {
        releasePainterlyMaterial(kit, mat as THREE.ShaderMaterial);
      } else {
        mat.dispose();
      }
    }

    function rebuildBots(list: BotNode[]) {
      // Hacker-pass c8: dispose per-bot materials on each 5 s rebuild (previously leaked
      // ~2 materials per bot per rebuild → thousands of orphaned materials per hour).
      while (botGroup.children.length) {
        const ch = botGroup.children[0]!;
        botGroup.remove(ch);
        if (ch instanceof THREE.Mesh || ch instanceof THREE.Sprite) {
          disposeBotMaterial(ch.material as THREE.Material);
        }
      }
      botVis.length = 0;
      botMeshes.length = 0;
      focusEase.clear();
      const capped = list.length > MAX_SCENE_BOTS ? list.slice(0, MAX_SCENE_BOTS) : list;
      for (const bot of capped) {
        const posArr = botWorldPosition(bot.id);
        const pos = new THREE.Vector3(...posArr);
        if (bot.id === "grok-build") {
          sunMesh.position.copy(pos);
          const mat = sunMesh.material as THREE.MeshStandardMaterial;
          mat.emissive = new THREE.Color(HEALTH_COLOR[bot.health]);
          continue;
        }
        const color = HEALTH_COLOR[bot.health];
        // Painter c7: watercolor core + glow (keeps botId pick target on mesh).
        const star = kit.createBotStar({ color, idle: bot.health === "idle" });
        const mesh = new THREE.Mesh(sphereGeo, star.meshMaterial);
        mesh.position.copy(pos);
        mesh.userData.botId = bot.id;
        botGroup.add(mesh);
        botMeshes.push(mesh);

        const glow = new THREE.Sprite(star.glowMaterial);
        // Portrait card + life-size character (ImagineNodeMaterial wash until map loads).
        const portraitUrl = `/dashboard-3d/art/portrait-${bot.id}.webp`;
        const cardMat = kit.createImagineNodeMaterial({ accent: color });
        const card = new THREE.Sprite(cardMat as unknown as THREE.SpriteMaterial);
        // Sprite needs SpriteMaterial — use Mesh plane for Imagine shader instead of Sprite.
        const cardPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), cardMat);
        cardPlane.position.copy(pos).add(new THREE.Vector3(0, 1.25, 0));
        cardPlane.userData.botId = bot.id;
        cardPlane.userData.kind = "portrait";
        botGroup.add(cardPlane);
        const personMat = kit.createImagineNodeMaterial({ accent: color });
        const person = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), personMat);
        person.position.copy(pos).add(new THREE.Vector3(1.35, 0.2, 0.4));
        person.userData.botId = bot.id;
        person.userData.kind = "character";
        botGroup.add(person);
        const applyPortrait = (tex: THREE.Texture) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const r1 = setImagineNodeMap(cardMat, tex, { maxTextureSize: maxTexSize });
          const r2 = setImagineNodeMap(personMat, tex, { maxTextureSize: maxTexSize });
          // Painter c5: surface sanitize failures honestly (wash stays; never silent).
          cardPlane.userData.imagineMapError = (cardMat.userData as { imagineMapError?: string | null }).imagineMapError ?? (r1.ok ? null : r1.reason);
          person.userData.imagineMapError = (personMat.userData as { imagineMapError?: string | null }).imagineMapError ?? (r2.ok ? null : r2.reason);
        };
        loader.load(
          portraitUrl,
          applyPortrait,
          undefined,
          () => {
            if (fallbackPortraitTex) {
              applyPortrait(fallbackPortraitTex);
              return;
            }
            loader.load(PORTRAIT_FALLBACK, (tex) => {
              fallbackPortraitTex = tex;
              applyPortrait(tex);
            });
          },
        );
        void card; // keep lint calm if Sprite unused
        glow.scale.set(2.2, 2.2, 2.2);
        glow.position.copy(pos);
        botGroup.add(glow);

        // Painter c5: lore plaque text atlas from real lock notes (honest empty if none).
        {
          const notesRaw = bot.lock?.notes || bot.notes || "";
          const loreMat = kit.createLorePlaqueMaterial({ accent: color });
          const atlas = createLoreTextAtlas(notesRaw, { maxTextureSize: maxTexSize, seed: hashStr(bot.id) });
          setLorePlaqueTextAtlas(loreMat, atlas, { owned: true });
          const lore = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), loreMat);
          lore.position.copy(pos).add(new THREE.Vector3(-1.2, 0.85, 0.15));
          lore.userData.botId = bot.id;
          lore.userData.kind = "lore";
          lore.userData.loreEmpty = atlas.empty;
          botGroup.add(lore);
        }

        const el = document.createElement("div");
        el.className = "dash3d-label";
        el.textContent = sanitizeLabelText(bot.name.replace(/ Bot$/, "").replace(" / Orchestrator", ""));
        const label = new CSS2DObject(el);
        label.position.set(pos.x, pos.y + 0.75, pos.z);
        botGroup.add(label);

        botVis.push({ id: bot.id, mesh, glow, label, health: bot.health, base: pos.clone(), setColor: star.setColor });
      }
    }


    // Shared scene characters / environments (real Imagine assets already in public/).
    const sceneArts = [
      { url: "/dashboard-3d/art/backdrop-nebula.webp", pos: new THREE.Vector3(-10, 4.5, -8), scale: [6.5, 3.8] as const },
      { url: "/dashboard-3d/art/backdrop-city.webp", pos: new THREE.Vector3(11, 2.2, -6), scale: [5.5, 3.2] as const },
      { url: "/dashboard-3d/art/backdrop-interior.webp", pos: new THREE.Vector3(0, -2.5, 9), scale: [4.8, 2.8] as const },
      { url: "/dashboard-3d/art/scene-operator-character.webp", pos: new THREE.Vector3(-6.5, 0.4, 4.5), scale: [2.2, 3.2] as const },
      { url: "/dashboard-3d/art/scene-agents-walk.webp", pos: new THREE.Vector3(7.5, 1.0, 5.5), scale: [5.2, 2.9] as const },
      { url: "/dashboard-3d/art/scene-fleet-guild.webp", pos: new THREE.Vector3(-9.5, 1.2, 2.0), scale: [5.4, 3.0] as const },
      { url: "/dashboard-3d/art/scene-notion-archive.webp", pos: new THREE.Vector3(9.8, 0.6, -1.5), scale: [5.0, 2.9] as const },
      { url: "/dashboard-3d/art/scene-city-street.webp", pos: new THREE.Vector3(2.5, -1.8, 10.5), scale: [5.6, 3.1] as const },
      { url: "/dashboard-3d/art/scene-merge-beacon.webp", pos: new THREE.Vector3(-11.5, 2.8, -2.5), scale: [5.0, 2.8] as const },
      { url: "/dashboard-3d/art/scene-collab-tower.webp", pos: new THREE.Vector3(10.2, -0.2, 3.8), scale: [4.8, 2.7] as const },
    ];
    for (const art of sceneArts) {
      const mat = kit.createImagineNodeMaterial({});
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(art.scale[0], art.scale[1]), mat);
      plane.position.copy(art.pos);
      plane.userData.kind = "scene";
      botGroup.add(plane);
      loader.load(
        art.url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const r = setImagineNodeMap(mat, tex, { maxTextureSize: maxTexSize });
          plane.userData.imagineMapError = (mat.userData as { imagineMapError?: string | null }).imagineMapError ?? (r.ok ? null : r.reason);
        },
        undefined,
        () => { /* missing art — wash fallback stays */ },
      );
    }

    // Gap#26: declare filter sets BEFORE applyEdgeVisibilityFilter / rebuildEdges (avoid TDZ)
    let graphFilter: GraphFilterState = { ...DEFAULT_GRAPH_FILTER };
    let graphVisibleIds: Set<string> | null = null; // null = no graph filter active
    let nhopVisibleIds: Set<string> | null = null; // Gap#6 local graph isolate

    type EdgeRec = { from: string; to: string; health: string; kind: string; fromPos: [number, number, number]; toPos: [number, number, number] };
    let edgeRecs: EdgeRec[] = [];
    let inkEdges: ReturnType<typeof kit.createInkEdges> | null = null;
    type LandingTrail = { points: Array<{ x: number; y: number; z: number }>; mesh: THREE.Mesh; seed: number; ease: TravelerEaseState; sample: TravelerEaseSample; lastProgress: number };
    const landingTrails: LandingTrail[] = [];
    const travelerGeo = new THREE.SphereGeometry(0.16, 12, 12);

    const posOfTuple = (id: string): [number, number, number] | null => {
      if (id === "grok-build") return [sunMesh.position.x, sunMesh.position.y, sunMesh.position.z];
      const v = botVis.find((b) => b.id === id);
      return v ? [v.base.x, v.base.y, v.base.z] : null;
    };

    const mapInkInput = (recs: EdgeRec[]) =>
      recs.map((e) => ({
        from: e.fromPos,
        to: e.toPos,
        health: e.health,
        kind: e.kind === "hub" ? "hub" : "link",
        id: `${e.from}>${e.to}`,
      }));

    const applyEdgeVisibilityFilter = () => {
      if (!inkEdges) return;
      const recs = filterEdgeRecsByVisibility(edgeRecs, nhopVisibleIds, graphVisibleIds);
      inkEdges.update(mapInkInput(recs));
    };

    function rebuildEdges(status: DashboardStatus) {
      edgeRecs = [];
      for (const e of status.constellationEdges) {
        const a = posOfTuple(e.from);
        const b = posOfTuple(e.to);
        if (!a || !b) continue;
        edgeRecs.push({
          from: e.from,
          to: e.to,
          health: e.health,
          kind: e.kind,
          fromPos: a,
          toPos: b,
        });
      }
      if (!inkEdges) {
        inkEdges = kit.createInkEdges(mapInkInput(edgeRecs));
        edgeGroup.add(inkEdges.group);
      } else {
        inkEdges.update(mapInkInput(edgeRecs));
      }
      applyEdgeVisibilityFilter();
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
      pageMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pages.length * 3), 3);
      const dummy = new THREE.Object3D();
      const baseCol = new THREE.Color(0x9bb7ff);
      pages.forEach((p, i) => {
        pageIdByIndex[i] = p.id;
        const [x, y, z] = positions[i]!;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        pageMesh!.setMatrixAt(i, dummy.matrix);
        pageMesh!.setColorAt(i, baseCol);
      });
      pageMesh.instanceMatrix.needsUpdate = true;
      if (pageMesh.instanceColor) pageMesh.instanceColor.needsUpdate = true;
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

    // Painter c9: batched lane nebulae (replace MeshBasicMaterial tint spheres)
    const nebulaGroup = new THREE.Group();
    scene.add(nebulaGroup);
    let laneNebulae: ReturnType<typeof kit.createLaneNebulae> | null = null;
    function rebuildNebulae(status: DashboardStatus) {
      const lanes = status.constellations.map((l) => ({
        health: l.health,
        center: l.center,
        id: l.id,
      }));
      if (!laneNebulae) {
        laneNebulae = kit.createLaneNebulae(lanes);
        nebulaGroup.add(laneNebulae.group);
      } else {
        laneNebulae.update(lanes);
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
        // Animation #3: landing-trail travelers (one per lane path)
        for (const tr of landingTrails) {
          landingGroup.remove(tr.mesh);
          (tr.mesh.material as THREE.Material).dispose();
        }
        landingTrails.length = 0;
        const baseY = -1.5;
        status.fleetPlan.landings.forEach((landing, li) => {
          const z = -10 - li * 2.2;
          const xs = [-6, -2, 2.5, 7];
          const points = landing.hops.map((hop, i) => ({
            x: xs[i] ?? i * 3,
            y: baseY + 0.2,
            z,
          }));
          if (points.length < 2) return;
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffe08a,
            emissive: 0xffc14a,
            emissiveIntensity: 0.9,
            transparent: true,
            opacity: 0.95,
          });
          const mesh = new THREE.Mesh(travelerGeo, mat);
          mesh.position.set(points[0]!.x, points[0]!.y, points[0]!.z);
          landingGroup.add(mesh);
          landingTrails.push({ points, mesh, seed: li * 1.7, ease: createTravelerEaseState(li * 1.7), sample: createTravelerEaseSample(), lastProgress: 0 });
        });
      }
    }
    rebuildAll();

    // --- Projects city (flyover queue #1) ---
    const city = createCityLayer(scene);
    let layout: CityLayout = buildCityLayout(dataRef.current.projects);
    let layoutSig = "";
    let fly: FlyState = { ...FLY_HOME };
    const knownIds = () => new Set(layout.buildings.map((b) => b.id));
    let layoutProgressSig = "";
    const syncCity = () => {
      const next = buildCityLayout(dataRef.current.projects);
      // Structure vs progress: live setBuildingProgress without full rebuild (Painter c11)
      const structSig = JSON.stringify(next.buildings.map((b) => [b.id, b.health, b.floors, b.x, b.z]));
      const progressSig = JSON.stringify(
        next.buildings.map((b) => [b.id, b.progressKnown ? b.litFloors : 0, b.progressKnown]),
      );
      layout = next;
      if (structSig !== layoutSig) {
        layoutSig = structSig;
        layoutProgressSig = progressSig;
        city.rebuild(layout);
      } else if (progressSig !== layoutProgressSig) {
        layoutProgressSig = progressSig;
        city.applyBuildingProgress(layout);
      }
      const reconciled = reconcileFlyover(fly, knownIds());
      if (reconciled !== fly) setFly(reconciled, true);
      else city.setInterior(fly.level === "interior" ? fly.buildingId : null);
    };

    const dust = createDustField(scene, { count: 480, seed: 42 });
    let comets = createCommitComets(scene, dataRef.current.commits, { max: 6 });
    let feedGlyphs = createFeedGlyphs(scene, dataRef.current.skyFeed?.events ?? []);
    let starHealthFilter: string = "all";

    let labelsOn = true;
    const pulseOut = { scale: 1, glow: 2, emissive: 0.7 };
    const driftOut = { x: 0, y: 0, z: 0 };

    let composer: EffectComposer | null = null;
    let bloomHandle: ReturnType<typeof createTunedBloomPass> | null = null;
    let gradeHandle: ReturnType<typeof createColorGradePass> | null = null;
    let raysHandle: ReturnType<typeof createGodRayPass> | null = null;
    // Light lane #12: idle until real weather arrives (not healthy-green before data)
    let exposureRide = createExposureRide({ tone: "idle", reducedMotion });
    exposureRide.apply(renderer);

    const rebuildPostfxBundle = () => {
      // Light #13: rebuild passes into the live composer after WebGL restore
      if (!composer || reducedMotion) {
        return { bloom: null, grade: null, godRays: null, exposure: exposureRide };
      }
      const w = Math.max(1, mount.clientWidth || width);
      const h = Math.max(1, mount.clientHeight || height);
      composer.passes.length = 0;
      composer.addPass(new RenderPass(scene, camera));
      let nextRays: typeof raysHandle = null;
      let nextBloom: typeof bloomHandle = null;
      let nextGrade: typeof gradeHandle = null;
      try {
        nextRays = createGodRayPass({ healthy: 0, total: 0, reducedMotion: false });
        if (composer.readBuffer?.depthTexture) {
          nextRays.setDepthTexture(composer.readBuffer.depthTexture, camera);
        }
        composer.addPass(nextRays.pass);
      } catch {
        nextRays = null;
      }
      try {
        nextBloom = createTunedBloomPass(new THREE.Vector2(w, h), "idle");
        composer.addPass(nextBloom.pass);
      } catch {
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.75, 0.22));
      }
      try {
        nextGrade = createColorGradePass("idle");
        composer.addPass(nextGrade.pass);
      } catch {
        nextGrade = null;
      }
      composer.addPass(kit.painterlyPass);
      bloomHandle = nextBloom;
      gradeHandle = nextGrade;
      raysHandle = nextRays;
      exposureRide = createExposureRide({ tone: "idle", reducedMotion });
      exposureRide.apply(renderer);
      return { bloom: nextBloom, grade: nextGrade, godRays: nextRays, exposure: exposureRide };
    };

    if (!reducedMotion) {
      try {
        const depthTex = new THREE.DepthTexture(Math.max(1, width), Math.max(1, height));
        const rt = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
          depthTexture: depthTex,
        });
        composer = new EffectComposer(renderer, rt);
      } catch {
        composer = new EffectComposer(renderer);
      }
      rebuildPostfxBundle();
    }

    const postfxRecovery = createContextLossRecovery({
      canvas: renderer.domElement,
      initial: { bloom: bloomHandle, grade: gradeHandle, godRays: raysHandle, exposure: exposureRide },
      factory: rebuildPostfxBundle,
    });

    let rig: CameraRigState = createRig(UNIVERSE_HIGH);
    let lookAt = new THREE.Vector3(...UNIVERSE_HIGH.lookAt);
    let freePos = new THREE.Vector3(...UNIVERSE_HIGH.position);
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
    let hoverPageId: string | null = null;
    let hoverBotId: string | null = null;
    const tipEl = document.createElement("div");
    tipEl.className = "dash3d-star-tooltip";
    tipEl.dataset.testid = "star-hover-tooltip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    mount.appendChild(tipEl);
    const hoverTipState = createHoverTooltipState();
    const hoverTipSample = createHoverTooltipSample();
    const edgePulseState = createEdgePulseState();
    const edgePulseSample = createEdgePulseSample();
    const setEdgeHover = (botId: string | null) => {
      // Painter c8 batches edges by health — boost uPulse on batches that contain the hover star.
      if (!inkEdges) return;
      for (const ch of inkEdges.group.children) {
        if (!(ch instanceof THREE.Mesh)) continue;
        const mat = ch.material as THREE.ShaderMaterial;
        if (!mat.uniforms?.["uPulse"]) continue;
        if (!botId) {
          mat.uniforms["uPulse"].value = 0.35;
          continue;
        }
        const tone = String(ch.userData.inkEdgeBatch || "");
        const hit = edgeRecs.some(
          (e) => e.health === tone && (e.from === botId || e.to === botId),
        );
        mat.uniforms["uPulse"].value = hit ? 0.85 : 0.12;
      }
    };
    const showBotTip = (botId: string | null, clientX: number, clientY: number) => {
      if (!botId) {
        tipEl.hidden = true;
        tipEl.textContent = "";
        setHoverTooltipTarget(hoverTipState, null);
        setEdgeHover(null);
        hoverBotId = null;
        return;
      }
      const bot = dataRef.current.bots.find((b) => b.id === botId);
      if (!bot) {
        showBotTip(null, clientX, clientY);
        return;
      }
      hoverBotId = botId;
      setHoverTooltipTarget(hoverTipState, botId);
      setEdgeHover(botId);
      const heartbeat = bot.lastActivityAt
        ? new Date(bot.lastActivityAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false }) + " WAT"
        : "—";
      tipEl.innerHTML = "";
      const title = document.createElement("strong");
      title.textContent = bot.name;
      const meta = document.createElement("div");
      meta.className = "dash3d-star-tooltip-meta";
      meta.textContent = `${bot.health} · ${bot.branch || "no branch"} · ${heartbeat}`;
      const lane = document.createElement("div");
      lane.className = "dash3d-muted";
      lane.style.fontSize = "0.68rem";
      lane.textContent = bot.id;
      tipEl.appendChild(title);
      tipEl.appendChild(meta);
      tipEl.appendChild(lane);
      tipEl.hidden = false;
      const rect = mount.getBoundingClientRect();
      tipEl.style.left = `${Math.min(rect.width - 200, Math.max(8, clientX - rect.left + 12))}px`;
      tipEl.style.top = `${Math.min(rect.height - 80, Math.max(8, clientY - rect.top + 12))}px`;
    };
    const pageIndexById = () => {
      const m = new Map<string, number>();
      pageIdByIndex.forEach((id, i) => m.set(id, i));
      return m;
    };
    const tintNotionNeighbors = (focusId: string | null) => {
      if (!pageMesh || !pageMesh.instanceColor) return;
      const base = new THREE.Color(0x9bb7ff);
      const hot = new THREE.Color(0xffe08a);
      const dim = new THREE.Color(0x3a4566);
      const idx = pageIndexById();
      const neigh = new Set<string>();
      if (focusId) {
        neigh.add(focusId);
        for (const e of dataRef.current.notionGraph.edges) {
          if (e.from === focusId && !e.to.startsWith("bot:")) neigh.add(e.to);
          if (e.to === focusId && !e.from.startsWith("bot:")) neigh.add(e.from);
        }
      }
      for (let i = 0; i < pageIdByIndex.length; i++) {
        const id = pageIdByIndex[i]!;
        if (!focusId) pageMesh.setColorAt(i, base);
        else if (neigh.has(id)) pageMesh.setColorAt(i, id === focusId ? hot : new THREE.Color(0x7c5cff));
        else pageMesh.setColorAt(i, dim);
      }
      pageMesh.instanceColor.needsUpdate = true;
    };


    function setFly(next: FlyState, fly2camera: boolean) {
      fly = next;
      city.setInterior(fly.level === "interior" ? fly.buildingId : null);
      city.setLabelsVisible(fly.level === "city");
      if (fly2camera) {
        rig = flyTo(
          rig,
          targetForState(fly, layout),
          [camera.position.x, camera.position.y, camera.position.z],
          [lookAt.x, lookAt.y, lookAt.z],
        );
      }
      cbs.current.onFlyoverChange?.(fly, layout);
    }
    const dispatchFly = (ev: FlyEvent) => {
      if (!acceptFlyDispatch(rig, ev.type)) return;
      const next = reduceFlyover(fly, ev, knownIds());
      if (next === fly) return;
      setFly(next, true);
      if (next.level === "universe") cbs.current.onSkyView();
    };
    const onFlyEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<FlyEvent>).detail;
      if (!detail || typeof detail !== "object" || typeof (detail as { type?: unknown }).type !== "string") return;
      dispatchFly(detail);
    };
    document.addEventListener("dash3d-fly", onFlyEvent);
    syncCity();
    setFly(fly, false);

    // Wheel: scroll up = in, down = out. Pushing against a clamp (accumulated) crosses levels.
    let limitPush = 0;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      if (rig.t < 1) return;
      const delta = Number.isFinite(ev.deltaY) ? Math.max(-400, Math.min(400, -ev.deltaY)) : 0;
      const [minD, maxD] = dollyLimits(fly.level);
      const cur: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const look: [number, number, number] = [lookAt.x, lookAt.y, lookAt.z];
      const dist = camera.position.distanceTo(lookAt);
      const atMin = dist <= minD + 0.05 && delta > 0;
      const atMax = dist >= maxD - 0.05 && delta < 0;
      if (atMin || atMax || fly.level === "interior") {
        limitPush += Math.abs(delta);
        if (limitPush > 360) {
          limitPush = 0;
          dispatchFly({ type: "WHEEL_LIMIT", direction: delta > 0 ? "in" : "out" });
        }
        if (fly.level === "interior") return;
      } else {
        limitPush = 0;
      }
      const next = dollyPose(cur, look, delta, minD, maxD);
      // If transitioning, cancel into free dolly
      freePos.set(...next);
      camera.position.copy(freePos);
      spherical.setFromVector3(freePos.clone().sub(lookAt));
      rig = { ...rig, t: 1, to: { position: next, lookAt: [lookAt.x, lookAt.y, lookAt.z] }, from: { position: next, lookAt: [lookAt.x, lookAt.y, lookAt.z] } };
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // Click-and-zoom: pinch → same dolly path as wheel
    const pinchPointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    const pinchDolly = (delta: number) => {
      if (rig.t < 1) return;
      const [minD, maxD] = dollyLimits(fly.level);
      const cur: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const look: [number, number, number] = [lookAt.x, lookAt.y, lookAt.z];
      const next = dollyPose(cur, look, delta, minD, maxD);
      freePos.set(...next);
      camera.position.copy(freePos);
      spherical.setFromVector3(freePos.clone().sub(lookAt));
      rig = { ...rig, t: 1, to: { position: next, lookAt: look }, from: { position: next, lookAt: look } };
    };
    const onPointerDown = (ev: PointerEvent) => {
      try { renderer.domElement.setPointerCapture(ev.pointerId); } catch { /* optional */ }
      pinchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinchPointers.size === 2) {
        const pts = [...pinchPointers.values()];
        pinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
    };
    const onPointerUp = (ev: PointerEvent) => {
      pinchPointers.delete(ev.pointerId);
      if (pinchPointers.size < 2) pinchDist = 0;
      try { renderer.domElement.releasePointerCapture(ev.pointerId); } catch { /* optional */ }
      // measure from drag start (lastX is updated during moves, so drags looked like clicks)
      const dx = Math.abs(ev.clientX - dragStartX);
      const dy = Math.abs(ev.clientY - dragStartY);
      const wasDrag = dx > 4 || dy > 4;
      dragging = false;
      if (wasDrag) return;
      // Hacker: ignore star/city picks while a camera glide is in flight
      if (!acceptPointerPick(rig)) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      if (fly.level !== "universe") {
        const cityHits = raycaster.intersectObjects(city.pickables, false);
        const pick = cityHits.find((h) => h.object.visible)?.object.userData.cityPick as
          | { buildingId: string; part: string; floor: number | null }
          | undefined;
        if (pick) {
          dispatchFly({
            type: "ENTER",
            buildingId: pick.buildingId,
            part: pick.part === "window" ? "window" : "door",
            floor: pick.floor ?? undefined,
          });
          return;
        }
        if (fly.level === "interior") return; // clicks inside a room don't eject you; use zoom-out
        dispatchFly({ type: "ZOOM_OUT" });
        return;
      }

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
            hoverPageId = pid;
            tintNotionNeighbors(pid);
            cbs.current.onSelectNotion(pid);
            return;
          }
        }
      }

      // empty space -> back up to the high universe view
      rig = flyTo(
        rig,
        { ...UNIVERSE_HIGH },
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
      );
      cbs.current.onSkyView();
    };
    const panRight = new THREE.Vector3();
    const panFwd = new THREE.Vector3();
    let dragStartX = 0;
    let dragStartY = 0;
    const onPointerMove = (ev: PointerEvent) => {
      if (pinchPointers.has(ev.pointerId)) {
        pinchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      }
      if (pinchPointers.size === 2) {
        const pts = [...pinchPointers.values()];
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (pinchDist > 0 && Number.isFinite(dist)) {
          const delta = Math.max(-400, Math.min(400, (dist - pinchDist) * 3));
          if (delta !== 0) pinchDolly(delta);
        }
        pinchDist = dist;
        return;
      }
      if (!dragging || rig.t < 1 || fly.level === "interior") return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (fly.level === "city") {
        // pan across the city plaza (clamped)
        const scale = camera.position.distanceTo(lookAt) * 0.0016;
        panRight.setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
        panFwd.set(-panRight.z, 0, panRight.x);
        const move = panRight.multiplyScalar(-dx * scale).add(panFwd.multiplyScalar(-dy * scale));
        const [nx, nz] = clampCityPan(lookAt.x + move.x, lookAt.z + move.z, layout);
        const shift = new THREE.Vector3(nx - lookAt.x, 0, nz - lookAt.z);
        lookAt.add(shift);
        freePos.add(shift);
        camera.position.copy(freePos);
        camera.lookAt(lookAt);
        return;
      }
      spherical.theta -= dx * 0.005;
      spherical.phi = Math.min(Math.PI * 0.45, Math.max(0.12, spherical.phi + dy * 0.005));
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      freePos.copy(lookAt).add(offset);
      camera.position.copy(freePos);
      camera.lookAt(lookAt);
    };
    const onPointerHoverStars = (ev: PointerEvent) => {
      if (dragging || fly.level !== "universe") {
        if (hoverBotId) showBotTip(null, ev.clientX, ev.clientY);
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(botMeshes, false);
      const id = (hits[0]?.object.userData.botId as string | undefined) ?? null;
      if (id !== hoverBotId) showBotTip(id, ev.clientX, ev.clientY);
      else if (id) showBotTip(id, ev.clientX, ev.clientY); // refresh position
    };
        const onPointerHoverNotion = (ev: PointerEvent) => {
      if (dragging || fly.level !== "universe" || !pageMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(pageMesh, false);
      const id = hits[0] && hits[0].instanceId != null ? pageIdByIndex[hits[0].instanceId] ?? null : null;
      if (id !== hoverPageId) {
        hoverPageId = id;
        tintNotionNeighbors(id);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointermove", onPointerHoverNotion);
    renderer.domElement.addEventListener("pointermove", onPointerHoverStars);
    renderer.domElement.addEventListener("pointerleave", () => { dragging = false; });

    const detachContext = attachPainterlyContextHandlers(renderer.domElement, kit, () => {
      layoutSig = ""; // force GPU resources to re-upload after restore
      syncCity();
      freezePendingClear = true; // clear freeze after first post-restore frame
    });
    // Gap#3: snapshot last frame on context lost so the stage does not flash splash/black.
    const onCtxLostFreeze = () => {
      const url = captureCanvasFrame(renderer.domElement);
      if (url) showLastFrameFreeze(mount, url);
    };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLostFreeze, false);

    let last = performance.now();
    let perfEma = 16.7;
    let labelsPaused = false;
    let raf = 0;
    let sync = 0;
    const travelOut = { x: 0, y: 0, z: 0 };
    const onVisibility = () => {
      // Animation #3: pause the loop while hidden; MotionClock absorbs the resume gap.
      if (!isDocumentHidden()) last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (kit.contextLost || postfxRecovery.lost) return; // WebGL context lost: pause (painter kit + light #13)
      if (isDocumentHidden()) {
        last = now;
        return;
      }
      const dt = sanitizeDt((now - last) / 1000);
      last = now;
      // Queue #17: EMA frame budget — pause CSS2D labels when 18+ bots run hot.
      perfEma = nextEmaFrameMs(perfEma, dt * 1000);
      {
        const perf = evaluatePerfBudget({ botCount: botVis.length, emaFrameMs: perfEma, labelsPaused });
        labelsPaused = perf.labelsPaused;
        try {
          if (perf.hint) document.documentElement.dataset.dashPerf = perf.hint;
          else delete document.documentElement.dataset.dashPerf;
        } catch {
          /* ignore */
        }
      }

      if (rig.t < 1) {
        const stepped = stepRigSmooth(rig, reducedMotion ? 10 : dt, reducedMotion ? 0.01 : 1.35);
        rig = stepped.rig;
        applyPose(stepped.position, stepped.lookAt);
      } else if (pendingFocusBotId) {
        const botId = pendingFocusBotId;
        pendingFocusBotId = null;
        document.dispatchEvent(new CustomEvent("dash3d-focus-bot", { detail: { botId } }));
      }

      stepHoverTooltip(hoverTipState, hoverTipSample, dt, reducedMotion);
      if (hoverTipSample.hoverId && !tipEl.hidden) {
        tipEl.style.opacity = String(hoverTipSample.opacity);
        tipEl.style.transform = `translateY(${hoverTipSample.offsetY}px) scale(${hoverTipSample.scale})`;
      } else if (!hoverTipSample.hoverId && tipEl.hidden === false && hoverTipSample.opacity < 0.02) {
        tipEl.hidden = true;
      }

      // billboard cards
      for (const ch of cardGroup.children) {
        ch.lookAt(camera.position);
      }

      const wallT = now * 0.001;
      const t = sharedMotionClock.map(wallT);
      for (const n of botVis) {
        const healthOk = starHealthFilter === "all" || n.health === starHealthFilter;
        const graphOk = !graphVisibleIds || graphVisibleIds.has(n.id);
        const nhopOk = !nhopVisibleIds || nhopVisibleIds.has(n.id);
        const show = healthOk && graphOk && nhopOk;
        n.mesh.visible = show;
        n.glow.visible = show;
        n.label.visible = show && labelsOn && fly.level === "universe" && !labelsPaused;
        const phase = pulsePhaseFromId(n.id);
        sampleStarPulse(pulseOut, wallT, phase, n.health, reducedMotion);
        sampleOrbitDrift(driftOut, { x: n.base.x, y: n.base.y, z: n.base.z }, wallT, phase, reducedMotion);
        let st = focusEase.get(n.id);
        if (!st) {
          st = createFocusEaseState();
          const held = motionPoseBag.focusById[n.id];
          if (held) restoreFocusPose(st, held);
          focusEase.set(n.id, st);
        }
        stepFocusEase(st, n.id, rig.subjectId, dt, reducedMotion);
        applyFocusPulse(pulseOut, st.pulseMul);
        applyFocusDrift(driftOut, n.base, st.driftMul);
        let scaleMul = pulseOut.scale;
        if (hoverTipSample.edge > 0.05 && hoverTipSample.hoverId) {
          const hid = hoverTipSample.hoverId;
          const neigh =
            n.id === hid ||
            edgeRecs.some((e) => (e.from === hid && e.to === n.id) || (e.to === hid && e.from === n.id));
          if (neigh) {
            stepEdgePulseSync(
              edgePulseState,
              edgePulseSample,
              hoverTipSample.edge,
              hid,
              n.id,
              hid,
              t,
              reducedMotion,
            );
            scaleMul *= edgePulseSample.neighborPulseMul;
          }
        }
        n.mesh.scale.setScalar(scaleMul);
        n.glow.scale.setScalar(pulseOut.glow * (scaleMul / Math.max(1e-6, pulseOut.scale)));
        if (n.setColor) n.setColor(HEALTH_COLOR[n.health], pulseOut.emissive);
        else {
          const mat = n.mesh.material as THREE.MeshStandardMaterial;
          if (mat.emissiveIntensity != null) mat.emissiveIntensity = pulseOut.emissive;
        }
        n.mesh.position.set(driftOut.x, driftOut.y, driftOut.z);
        n.glow.position.set(driftOut.x, driftOut.y, driftOut.z);
        n.label.position.set(driftOut.x, driftOut.y + 0.75, driftOut.z);
        // label visibility owned above (health filter + labels layer + fly level)
      }
      if (!reducedMotion) {
        inkEdges?.tick(t);
        const edgeFocusId = rig.subjectId ?? hoverTipSample.hoverId;
        // Motion c11: drive ink uPulse from hover edge strength + focus orientation sample
        if (inkEdges && edgeRecs.length) {
          const sample = edgeRecs[0]!;
          stepEdgePulseSync(
            edgePulseState,
            edgePulseSample,
            hoverTipSample.edge,
            sample.from,
            sample.to,
            edgeFocusId,
            t,
            reducedMotion,
          );
          for (const ch of inkEdges.group.children) {
            if (!(ch instanceof THREE.Mesh)) continue;
            const mat = ch.material as THREE.ShaderMaterial;
            if (!mat.uniforms?.["uPulse"]) continue;
            const base = 0.35;
            mat.uniforms["uPulse"].value = Math.min(1, base + 0.55 * edgePulseSample.highlight);
          }
        }
        for (const tr of landingTrails) {
          stepTravelerEase(tr.ease, tr.sample, tr.points, t, dt, reducedMotion);
          // Motion c13: gust dust when a landing traveler wraps a hop loop (real event)
          if (!reducedMotion && tr.sample.progress + 0.5 < tr.lastProgress) {
            dust.impulseGust(0.55, 0.12, -0.35, 0.45);
          }
          tr.lastProgress = tr.sample.progress;
          tr.mesh.position.set(tr.sample.x, tr.sample.y + 0.35, tr.sample.z);
          (tr.mesh.material as THREE.MeshStandardMaterial).opacity = tr.sample.opacity;
          tr.mesh.visible = fly.level === "universe";
        }
      } else {
        for (const tr of landingTrails) tr.mesh.visible = false;
      }
      city.tick(wallT, reducedMotion);
      dust.update(wallT, reducedMotion);
      comets.update(wallT, reducedMotion);
      feedGlyphs.update(wallT, reducedMotion);
      const botsNow = dataRef.current.bots;
      const tone = dataRef.current.weather?.tone ?? deriveFleetTone(botsNow.map((b) => b.health));
      const healthy = botsNow.filter((b) => b.health === "healthy").length;
      const total = botsNow.length;
      const localHour = new Date().getHours(); // box clock = Africa/Lagos
      exposureRide.setTarget({ tone, hour: localHour, reducedMotion });
      exposureRide.tick(dt * 1000);
      const liveBloom = postfxRecovery.bundle.bloom ?? bloomHandle;
      const liveGrade = postfxRecovery.bundle.grade ?? gradeHandle;
      const liveRays = postfxRecovery.bundle.godRays ?? raysHandle;
      const liveExposure = postfxRecovery.bundle.exposure ?? exposureRide;
      liveExposure.apply(renderer, liveBloom ?? undefined);

      // Painter c11: always tick (freezes uTime under RM; also flushes throttled resizePass)
      tickPainterlyKit(kit, t, { reducedMotion });
      kit.setPassHealth({ healthy, total, reducedMotion });
      if (!reducedMotion) {
        sun.intensity = 80 + Math.sin(t * 1.5) * 12;
        if (atm) atm.update(tone);
        liveBloom?.update(tone);
        liveGrade?.update(tone);
        if (liveRays) {
          liveRays.setSun(sunMesh.position, camera);
          liveRays.update({ healthy, total, reducedMotion: false, tone: tone as never });
        }
      }

      if (composer) composer.render();
      else renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      if (freezePendingClear) {
        freezePendingClear = false;
        hideLastFrameFreeze(mount);
      }

      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) {
        document.dispatchEvent(
          new CustomEvent("dash3d-camera", {
            detail: { lookAt: [lookAt.x, lookAt.y, lookAt.z] as [number, number, number] },
          }),
        );
      }
      if (now - sync > 5000) {
        sync = now;
        rebuildAll();
        syncCity();
        comets.dispose();
        comets = createCommitComets(scene, dataRef.current.commits, { max: 6 });
        feedGlyphs.dispose();
      inkEdges?.dispose();
      inkEdges = null;
      laneNebulae?.dispose();
      laneNebulae = null;
        feedGlyphs = createFeedGlyphs(scene, dataRef.current.skyFeed?.events ?? []);
      }
    };
    tick(performance.now());

    const onResize = () => {
      const w = Math.max(1, mount.clientWidth || window.innerWidth || 1);
      const h = Math.max(1, mount.clientHeight || window.innerHeight || 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      composer?.setSize(w, h);
      bloomHandle?.setSize?.(w, h);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      kit.resizePass(w, h, dpr);
      if (raysHandle && composer?.readBuffer?.depthTexture) {
        raysHandle.setDepthTexture(composer.readBuffer.depthTexture, camera);
      }
    };
    
    const onSkyEvent = () => {
      if (fly.level !== "universe") {
        dispatchFly({ type: "SKY" });
        return;
      }
      rig = flyTo(
        rig,
        { ...UNIVERSE_HIGH },
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
      );
      cbs.current.onSkyView();
    };

    const onFocusBot = (ev: Event) => {
      const botId = (ev as CustomEvent<{ botId?: string }>).detail?.botId;
      if (!botId) return;
      const bot = dataRef.current.bots.find((b) => b.id === botId);
      if (!bot) {
        // Unknown id: clear misleading stale detail by selecting nothing useful
        cbs.current.onSkyView();
        return;
      }
      // Always update selection immediately so STAR DETAIL matches the latest request (Gap#10).
      cbs.current.onSelectBot(bot);
      const pos =
        bot.id === "grok-build"
          ? ([sunMesh.position.x, sunMesh.position.y, sunMesh.position.z] as [number, number, number])
          : botWorldPosition(bot.id);
      const target = focusBotTarget(pos, bot.id, fly.level === "interior" ? "interior" : "universe");
      if (!acceptPointerPick(rig)) {
        pendingFocusBotId = botId;
        return;
      }
      pendingFocusBotId = null;
      rig = flyTo(
        rig,
        target,
        [camera.position.x, camera.position.y, camera.position.z],
        [lookAt.x, lookAt.y, lookAt.z],
      );
    };
    document.addEventListener("dash3d-focus-bot", onFocusBot);
    const onLayers = (ev: Event) => {
      const d = (ev as CustomEvent<{ labels?: boolean; healthFilter?: string }>).detail || {};
      if (typeof d.labels === "boolean") {
        labelsOn = d.labels;
        city.setLabelsVisible(labelsOn && fly.level === "city");
      }
      if (typeof d.healthFilter === "string") starHealthFilter = d.healthFilter;
    };
    document.addEventListener("dash3d-layers", onLayers);
    const onGraphFilter = (ev: Event) => {
      const d = (ev as CustomEvent<GraphFilterState>).detail;
      if (!d || typeof d !== "object") return;
      graphFilter = { ...DEFAULT_GRAPH_FILTER, ...d };
      const active =
        Boolean(graphFilter.query.trim()) ||
        graphFilter.orphansOnly ||
        graphFilter.health !== "all" ||
        graphFilter.lane !== "all";
      if (!active) {
        graphVisibleIds = null;
      } else {
        graphVisibleIds = filterBotIds(
          dataRef.current.bots,
          dataRef.current.constellationEdges ?? [],
          graphFilter,
        );
      }
      applyEdgeVisibilityFilter();
    };
    document.addEventListener("dash3d-graph-filter", onGraphFilter);
    const onNhop = (ev: Event) => {
      const d = (ev as CustomEvent<{ botId?: string | null; depth?: number; isolate?: boolean }>).detail || {};
      if (!d.isolate || !d.botId) {
        nhopVisibleIds = null;
      } else {
        nhopVisibleIds = nhopBotIds(
          d.botId,
          dataRef.current.constellationEdges ?? [],
          Number(d.depth) || 0,
        );
      }
      applyEdgeVisibilityFilter();
    };
    document.addEventListener("dash3d-nhop", onNhop);


    document.addEventListener("dash3d-sky", onSkyEvent);

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("dash3d-focus-bot", onFocusBot);
      document.removeEventListener("dash3d-layers", onLayers);
      document.removeEventListener("dash3d-graph-filter", onGraphFilter);
      document.removeEventListener("dash3d-nhop", onNhop);
      document.removeEventListener("dash3d-sky", onSkyEvent);
      document.removeEventListener("dash3d-fly", onFlyEvent);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextlost", onCtxLostFreeze, false);
      // Gap#3: snapshot before teardown so remount keeps last frame (no splash flash).
      const lastUrl = captureCanvasFrame(renderer.domElement);
      if (lastUrl) showLastFrameFreeze(mount, lastUrl);
      // Motion c9 pose-hold: capture focus easing before state teardown.
      for (const [id, st] of focusEase) {
        motionPoseBag.focusById[id] ??= createFocusPoseHold();
        captureFocusPose(motionPoseBag.focusById[id]!, st);
      }
      detachContext();
      city.dispose();
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointermove", onPointerHoverNotion);
      renderer.domElement.removeEventListener("pointermove", onPointerHoverStars);
      tipEl.remove();
      cancelAnimationFrame(raf);
      dust.dispose();
      comets.dispose();
      feedGlyphs.dispose();
      sphereGeo.dispose();
      pageGeo.dispose();
      travelerGeo.dispose();
      starTex.dispose();
      skyMat.map?.dispose();
      skyMat.dispose();
      disposePainterlyKit(kit);
      postfxRecovery.dispose(); // light #13: listeners + bloom/grade/rays/exposure
      renderer.dispose();
      composer?.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentElement === mount) mount.removeChild(labelRenderer.domElement);
    };
  }, [reducedMotion, onUnavailable]);

  return <div className="dash3d-canvas-wrap" ref={mountRef} />;
}
