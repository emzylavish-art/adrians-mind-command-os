import * as THREE from "three";
import type { FleetPlan } from "@/lib/mind/dashboard/fleet-plan";
import { queueWaypointPositions } from "@/lib/mind/dashboard/queue-parse";
import type { Health } from "@/lib/mind/dashboard/types";
import {
  releasePainterlyMaterial,
  type PainterlyKit,
  type PainterlyFleetBeaconBundle,
} from "./materials";

const HEALTH_COLOR: Record<Health, number> = {
  healthy: 0x3dd68c,
  stalled: 0xfbbf24,
  blocked: 0xff6b8a,
  idle: 0x5b6b8c,
};

type FleetBeaconStatus = "done" | "active" | "queued" | "reached" | "pending";

export function clearGroup(group: THREE.Group, kit?: PainterlyKit | null) {
  while (group.children.length) {
    const ch = group.children[0]!;
    group.remove(ch);
    const beacon = ch.userData.fleetBeacon as PainterlyFleetBeaconBundle | undefined;
    if (beacon && kit) {
      try {
        releasePainterlyMaterial(kit, beacon.meshMaterial);
      } catch { /* */ }
      try {
        beacon.glowMaterial.dispose();
      } catch { /* */ }
    }
    ch.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
        obj.geometry?.dispose?.();
        const mat = obj.material as THREE.Material | THREE.Material[];
        if (!beacon) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      }
    });
  }
}

function line(a: THREE.Vector3, b: THREE.Vector3, color: number, opacity = 0.85) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

/** Painter c27 — watercolor fleet beacons (replaces MeshStandard neon LEDs). */
function ball(
  kit: PainterlyKit,
  pos: THREE.Vector3,
  color: number,
  r = 0.42,
  status: FleetBeaconStatus = "done",
) {
  const beacon = kit.createFleetBeacon({ color, status, radius: r });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(beacon.radius, 20, 20),
    beacon.meshMaterial,
  );
  const glow = new THREE.Sprite(beacon.glowMaterial);
  glow.scale.setScalar(1.15);
  const g = new THREE.Group();
  mesh.position.set(0, 0, 0);
  glow.position.set(0, 0, 0);
  g.add(mesh, glow);
  g.position.copy(pos);
  g.userData.fleetBeacon = beacon;
  return g;
}

/** Landing highway: fleet tip → dashboard-3d → preview/integration → main (+ merge gate). */
export function rebuildLandingPaths(group: THREE.Group, plan: FleetPlan, kit: PainterlyKit) {
  clearGroup(group, kit);
  const baseY = -1.5;
  plan.landings.forEach((landing, li) => {
    const z = -10 - li * 2.2;
    const hops = landing.hops;
    const xs = [-6, -2, 2.5, 7];
    const points: THREE.Vector3[] = [];
    hops.forEach((hop, i) => {
      const color = hop.reached ? 0x3dd68c : 0xfbbf24;
      const opacity = hop.reached ? 0.95 : 0.45;
      const p = new THREE.Vector3(xs[i] ?? i * 3, baseY + 0.2, z);
      points.push(p);
      const node = ball(kit, p, color, hop.hop === "main" ? 0.5 : 0.4, hop.reached ? "reached" : "pending");
      node.userData.landingHop = `${landing.lane}:${hop.hop}`;
      group.add(node);
      if (i > 0) group.add(line(points[i - 1]!, p, color, opacity));
    });
    // Merge gate node between dashboard-3d and preview
    const gate = new THREE.Vector3((-2 + 2.5) / 2, baseY + 1.1, z);
    const gateMesh = ball(kit, gate, 0x7c5cff, 0.22, "active");
    gateMesh.userData.mergeGate = true;
    group.add(gateMesh);
    group.add(line(points[1]!, gate, 0x7c5cff, 0.5));
    group.add(line(gate, points[2]!, 0x7c5cff, landing.mergedIntoPreviewIntegration ? 0.55 : 0.2));
  });
}

/** Sky road of queue waypoints. */
export function rebuildQueueRoad(group: THREE.Group, plan: FleetPlan, kit: PainterlyKit) {
  clearGroup(group, kit);
  const positions = queueWaypointPositions(plan.queue.length);
  plan.queue.forEach((item, i) => {
    const [x, y, z] = positions[i] ?? [0, 8, 0];
    const color =
      item.status === "done" ? 0x3dd68c : item.status === "active" ? 0xffe08a : 0x5b6b8c;
    const status: FleetBeaconStatus =
      item.status === "done" ? "done" : item.status === "active" ? "active" : "queued";
    const node = ball(kit, new THREE.Vector3(x, y, z), color, item.status === "active" ? 0.55 : 0.4, status);
    node.userData.queueIndex = item.index;
    group.add(node);
    if (i > 0) {
      const prev = positions[i - 1]!;
      group.add(
        line(
          new THREE.Vector3(...prev),
          new THREE.Vector3(x, y, z),
          item.status === "queued" ? 0x3a4566 : color,
          item.status === "queued" ? 0.35 : 0.9,
        ),
      );
    }
  });
}

/** Extra lane lines among visual fleet stars using known world positions from constellation centers. */
export function rebuildFleetLaneLines(
  group: THREE.Group,
  plan: FleetPlan,
  posOf: (botId: string) => THREE.Vector3 | null,
) {
  clearGroup(group);
  const ids = plan.fleetStars.map((s) => s.botId);
  for (let i = 0; i < ids.length - 1; i++) {
    const a = posOf(ids[i]!);
    const b = posOf(ids[i + 1]!);
    if (!a || !b) continue;
    const health = plan.fleetStars[i]!.health;
    group.add(line(a, b, HEALTH_COLOR[health], 0.65));
  }
  // spoke to dashboard bot if present
  const dash = posOf("dashboard");
  const painter = posOf("cosmos-painter");
  if (dash && painter) group.add(line(dash, painter, 0x7c5cff, 0.35));
}
