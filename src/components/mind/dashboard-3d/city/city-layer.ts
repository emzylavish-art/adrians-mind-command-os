import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { createBuildingBrushMaterial, tickBuildingMaterial } from "../materials";
import { sanitizeLabelText } from "@/lib/mind/dashboard/health";
import type { Health } from "@/lib/mind/dashboard/types";
import type { CityLayout } from "@/lib/mind/dashboard/city-layout";
import { CITY_Y, CLOUD_Y } from "@/lib/mind/dashboard/flyover-fsm";

export const CITY_HEALTH_COLOR: Record<Health, number> = {
  healthy: 0x3dd68c,
  stalled: 0xfbbf24,
  blocked: 0xff6b8a,
  idle: 0x5b6b8c,
};

export type CityPick = { buildingId: string; part: "door" | "window" | "facade"; floor: number | null };

export type CityLayerHandle = {
  group: THREE.Group;
  clouds: THREE.Group;
  pickables: THREE.Object3D[];
  rebuild(layout: CityLayout): void;
  setInterior(buildingId: string | null): void;
  setLabelsVisible(v: boolean): void;
  tick(t: number, reducedMotion: boolean): void;
  dispose(): void;
  /** resource counts for leak tests / audit */
  counts(): { buildings: number; materials: number; geometries: number };
};

function makeCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 9; i++) {
    const x = size / 2 + Math.cos(i * 2.1) * size * 0.18;
    const y = size / 2 + Math.sin(i * 1.7) * size * 0.1;
    const r = size * (0.22 + (i % 3) * 0.05);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(190,205,255,0.32)");
    g.addColorStop(0.6, "rgba(120,140,210,0.12)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The Projects city: painted brush buildings on a dark-glass plaza far below the universe,
 * under a cloud deck. Floors = real task counts; lit windows = real progress only.
 */
export function createCityLayer(scene: THREE.Scene): CityLayerHandle {
  const group = new THREE.Group();
  group.name = "dash3d-city";
  scene.add(group);
  const clouds = new THREE.Group();
  clouds.name = "dash3d-clouds";
  scene.add(clouds);

  // --- static: dark glass plaza + grid
  const groundGeo = new THREE.CircleGeometry(40, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a1020,
    roughness: 0.25,
    metalness: 0.6,
    transparent: true,
    opacity: 0.92,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = CITY_Y;
  group.add(ground);
  const grid = new THREE.GridHelper(60, 30, 0x2b3a66, 0x16203d);
  grid.position.y = CITY_Y + 0.01;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.45;
  group.add(grid);
  const cityLight = new THREE.HemisphereLight(0x8ea0ff, 0x0a0f20, 1.1);
  cityLight.position.set(0, CITY_Y + 20, 0);
  group.add(cityLight);

  // --- static: clouds between universe and city
  const cloudTex = makeCloudTexture();
  const cloudMats: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.55 });
    cloudMats.push(mat);
    const s = new THREE.Sprite(mat);
    const a = (i / 26) * Math.PI * 2;
    const r = 6 + ((i * 37) % 17);
    s.position.set(Math.cos(a) * r, CLOUD_Y + ((i * 13) % 5) - 2, Math.sin(a) * r);
    const sc = 9 + ((i * 7) % 6);
    s.scale.set(sc, sc * 0.55, 1);
    s.userData.baseX = s.position.x;
    clouds.add(s);
  }

  // --- dynamic: buildings
  const dyn = new THREE.Group();
  group.add(dyn);
  const pickables: THREE.Object3D[] = [];
  const brushMats: THREE.ShaderMaterial[] = [];
  const ownedMats: THREE.Material[] = [];
  const ownedGeos: THREE.BufferGeometry[] = [];
  const exteriors = new Map<string, THREE.Object3D[]>();
  const interiors = new Map<string, THREE.Group>();
  const labels: CSS2DObject[] = [];
  let buildingCount = 0;
  let labelsVisible = true;

  function clearDynamic() {
    for (const l of labels) {
      l.element.remove();
    }
    labels.length = 0;
    while (dyn.children.length) dyn.remove(dyn.children[0]!);
    for (const m of brushMats) m.dispose();
    for (const m of ownedMats) m.dispose();
    for (const g of ownedGeos) g.dispose();
    brushMats.length = 0;
    ownedMats.length = 0;
    ownedGeos.length = 0;
    pickables.length = 0;
    exteriors.clear();
    interiors.clear();
    buildingCount = 0;
  }

  function rebuild(layout: CityLayout) {
    clearDynamic();
    for (const b of layout.buildings) {
      const color = CITY_HEALTH_COLOR[b.health];
      const accent = new THREE.Color(color);
      const shell = new THREE.Group();
      shell.position.set(b.x, CITY_Y, b.z);
      dyn.add(shell);

      const bodyGeo = new THREE.BoxGeometry(b.width, b.height, b.depth);
      ownedGeos.push(bodyGeo);
      const mat = createBuildingBrushMaterial({
        base: 0x121a30,
        accent,
        floors: b.floors,
        progress: b.progressKnown ? b.litFloors / b.floors : 0,
        paper: 0.16,
      });
      brushMats.push(mat);
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.y = b.height / 2;
      body.userData.cityPick = { buildingId: b.id, part: "facade", floor: null } satisfies CityPick;
      shell.add(body);
      pickables.push(body);
      const ext: THREE.Object3D[] = [body];

      // glowing windows: one per floor on the front face; lit only for real progress
      const winGeo = new THREE.PlaneGeometry(b.width * 0.62, b.floorHeight * 0.5);
      ownedGeos.push(winGeo);
      const litMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const dimMat = new THREE.MeshBasicMaterial({ color: 0x24304f, transparent: true, opacity: 0.85 });
      ownedMats.push(litMat, dimMat);
      for (let f = 1; f < b.floors; f++) {
        const w = new THREE.Mesh(winGeo, f < b.litFloors ? litMat : dimMat);
        w.position.set(0, 0.15 + f * b.floorHeight + b.floorHeight / 2, b.depth / 2 + 0.01);
        w.userData.cityPick = { buildingId: b.id, part: "window", floor: f } satisfies CityPick;
        shell.add(w);
        pickables.push(w);
        ext.push(w);
      }
      // door (ground floor) — glowing health-colored portal
      const doorGeo = new THREE.PlaneGeometry(b.width * 0.34, b.floorHeight * 0.85);
      ownedGeos.push(doorGeo);
      const doorMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      ownedMats.push(doorMat);
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(0, (b.floorHeight * 0.85) / 2 + 0.02, b.depth / 2 + 0.012);
      door.userData.cityPick = { buildingId: b.id, part: "door", floor: 0 } satisfies CityPick;
      shell.add(door);
      pickables.push(door);
      ext.push(door);
      // roof beacon
      const beaconGeo = new THREE.SphereGeometry(0.12, 10, 10);
      ownedGeos.push(beaconGeo);
      const beacon = new THREE.Mesh(beaconGeo, doorMat);
      beacon.position.y = b.height + 0.2;
      shell.add(beacon);
      ext.push(beacon);
      exteriors.set(b.id, ext);

      // interior: floor slabs (done floors in health color, open floors dim glass), hidden by default
      const inside = new THREE.Group();
      inside.visible = false;
      const slabGeo = new THREE.BoxGeometry(b.width * 0.92, 0.04, b.depth * 0.92);
      ownedGeos.push(slabGeo);
      const slabLit = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
      const slabDim = new THREE.MeshBasicMaterial({ color: 0x4a5c92, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide });
      const wallMat = new THREE.MeshBasicMaterial({
        color: 0x0c1428,
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        depthWrite: false,
      });
      const ringLit = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const ringDim = new THREE.LineBasicMaterial({ color: 0x7d8fbf, transparent: true, opacity: 0.75 });
      ownedMats.push(slabLit, slabDim, wallMat, ringLit, ringDim);
      const slabEdges = new THREE.EdgesGeometry(slabGeo);
      ownedGeos.push(slabEdges);
      for (let f = 0; f <= b.floors; f++) {
        const lit = f > 0 && f <= b.litFloors;
        const slab = new THREE.Mesh(slabGeo, lit ? slabLit : slabDim);
        slab.position.y = 0.15 + f * b.floorHeight;
        inside.add(slab);
        const ring = new THREE.LineSegments(slabEdges, lit ? ringLit : ringDim);
        ring.position.y = slab.position.y;
        inside.add(ring);
      }
      // task lanterns: one per real task, distributed up the floors (done = health/green, open = amber)
      const lanternGeo = new THREE.SphereGeometry(0.07, 10, 10);
      ownedGeos.push(lanternGeo);
      const lanternDone = new THREE.MeshBasicMaterial({ color: CITY_HEALTH_COLOR.healthy });
      const lanternOpen = new THREE.MeshBasicMaterial({ color: CITY_HEALTH_COLOR.stalled });
      ownedMats.push(lanternDone, lanternOpen);
      const nT = b.taskStates.length;
      b.taskStates.forEach((st, i) => {
        const fl = Math.min(b.floors - 1, Math.floor((i / Math.max(1, nT)) * b.floors));
        const a = i * 2.399; // golden-angle spread on the floor
        const r = Math.min(b.width, b.depth) * 0.3;
        const l = new THREE.Mesh(lanternGeo, st === "done" ? lanternDone : lanternOpen);
        l.position.set(Math.cos(a) * r, 0.15 + fl * b.floorHeight + b.floorHeight * 0.45, Math.sin(a) * r - b.depth * 0.1);
        inside.add(l);
      });
      const wallGeo = new THREE.BoxGeometry(b.width, b.height, b.depth);
      ownedGeos.push(wallGeo);
      const walls = new THREE.Mesh(wallGeo, wallMat);
      walls.position.y = b.height / 2;
      inside.add(walls);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
      ownedGeos.push(wire.geometry);
      ownedMats.push(wire.material as THREE.Material);
      wire.position.y = b.height / 2;
      inside.add(wire);
      shell.add(inside);
      interiors.set(b.id, inside);

      // label (textContent + sanitize — never innerHTML)
      const el = document.createElement("div");
      el.className = `dash3d-label dash3d-city-label ${b.health}`;
      el.textContent = sanitizeLabelText(b.name.replace(/ Bot$/, ""), 28);
      const label = new CSS2DObject(el);
      label.visible = labelsVisible;
      label.position.set(0, b.height + 0.6, 0);
      shell.add(label);
      labels.push(label);
      buildingCount += 1;
    }
  }

  function setInterior(buildingId: string | null) {
    for (const [id, objs] of exteriors) {
      const inside = id === buildingId;
      for (const o of objs) o.visible = !inside;
      const g = interiors.get(id);
      if (g) g.visible = inside;
    }
  }

  function setLabelsVisible(v: boolean) {
    labelsVisible = v;
    // CSS2DRenderer rewrites element.style.display every frame from object.visible.
    for (const l of labels) l.visible = v;
  }

  function tick(t: number, reducedMotion: boolean) {
    if (reducedMotion) return;
    for (const m of brushMats) tickBuildingMaterial(m, t);
    for (const c of clouds.children) {
      const base = (c.userData.baseX as number) ?? 0;
      c.position.x = base + Math.sin(t * 0.05 + base) * 1.5;
    }
  }

  function dispose() {
    clearDynamic();
    scene.remove(group);
    scene.remove(clouds);
    groundGeo.dispose();
    groundMat.dispose();
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    for (const m of cloudMats) m.dispose();
    cloudTex.dispose();
  }

  return {
    group,
    clouds,
    pickables,
    rebuild,
    setInterior,
    setLabelsVisible,
    tick,
    dispose,
    counts: () => ({ buildings: buildingCount, materials: brushMats.length + ownedMats.length, geometries: ownedGeos.length }),
  };
}
