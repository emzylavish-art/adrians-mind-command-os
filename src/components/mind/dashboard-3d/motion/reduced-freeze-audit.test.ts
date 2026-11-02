/**
 * Motion c26 — reduced-motion freeze audit.
 * REA c24/c25 reduced canvas uniqueSamples were 4 then 6: something still changes
 * under prefers-reduced-motion. This suite hashes motion/ + particles/ outputs across
 * 60 frames at reduced=true; any frame-to-frame delta is a lane regression.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  createFocusEaseState,
  createHealthPulseCrossfadeState,
  createMotionClock,
  createTravelerEaseSample,
  createTravelerEaseState,
  sampleOrbitDrift,
  sampleStarPulse,
  stepCharacterMotion,
  createCharacterMotionState,
  createCharacterSample,
  stepCometLaunchEase,
  createCometLaunchSample,
  createCometLaunchState,
  reconcileCometLaunch,
  stepEdgePulseSync,
  createEdgePulseSample,
  createEdgePulseState,
  stepFocusRingBreathe,
  createFocusRingBreatheSample,
  createFocusRingBreatheState,
  stepFocusStillTarget,
  stepHoverTooltip,
  createHoverTooltipSample,
  createHoverTooltipState,
  setHoverTooltipTarget,
  stepStarFieldBatch,
  stepTravelerTrails,
  stepWindGust,
  createWindGustSample,
  createWindGustState,
  impulseWindGust,
} from "./index.ts";
import {
  applyCometLaunchSamples,
  createCommitComets,
  createDustField,
} from "../particles/index.ts";

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

function meshSnapshot(scene: THREE.Scene): unknown[] {
  const out: unknown[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.InstancedMesh) {
      const m = (o as THREE.Mesh).material as THREE.Material & { opacity?: number; size?: number };
      out.push({
        n: o.name,
        v: o.visible,
        x: +o.position.x.toFixed(5),
        y: +o.position.y.toFixed(5),
        z: +o.position.z.toFixed(5),
        sx: +o.scale.x.toFixed(5),
        sy: +o.scale.y.toFixed(5),
        sz: +o.scale.z.toFixed(5),
        op: m && "opacity" in m ? +Number(m.opacity).toFixed(5) : null,
        szp: m && "size" in m ? +Number((m as THREE.PointsMaterial).size).toFixed(5) : null,
        ic: o instanceof THREE.InstancedMesh ? o.count : null,
      });
    }
  });
  return out;
}

describe("c26 — reduced-motion freeze audit (motion/particles)", () => {
  it("star-batch + stillTarget + pulse/orbit helpers are bit-stable across 60 reduced frames", () => {
    const clock = createMotionClock();
    const ids = ["a", "b", "c"];
    const healths = ["healthy", "stalled", "idle"];
    const bases = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: -1, y: 0, z: 1 },
    ];
    const focus = ids.map(() => createFocusEaseState());
    const pulse = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
    const pos = ids.map(() => ({ x: 0, y: 0, z: 0 }));
    const xfade = ids.map((h, i) => createHealthPulseCrossfadeState(healths[i]!));
    const hashes: string[] = [];
    for (let f = 0; f < 60; f++) {
      for (const p of pulse) {
        p.scale = 1;
        p.glow = 2;
        p.emissive = 0.5;
      }
      stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "a", 10 + f / 60, 1 / 60, true, 3, {
        clock,
        xfade,
        stillTarget: true,
      });
      const orbit = { x: 0, y: 0, z: 0 };
      sampleOrbitDrift(orbit, bases[1]!, 10 + f / 60, 0.2, true, { clock });
      const sp = { scale: 1, glow: 2, emissive: 0.5 };
      sampleStarPulse(sp, 10 + f / 60, 0.3, "healthy", true, clock);
      hashes.push(hash([pulse, pos, focus, orbit, sp]));
    }
    const unique = new Set(hashes);
    assert.equal(unique.size, 1, `star helpers not frozen under reduced: ${unique.size} unique hashes`);
  });

  it("dust + comets + applyCometLaunchSamples mesh state is bit-stable under reduced", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 64, lod: true });
    const comets = createCommitComets(scene, [{ sha: "a" }, { sha: "b" }, { sha: "c" }], { max: 6 });
    const launch = createCometLaunchState(24);
    const samples = Array.from({ length: 24 }, () => createCometLaunchSample());
    reconcileCometLaunch(launch, comets.shas!, true);
    const hashes: string[] = [];
    for (let f = 0; f < 60; f++) {
      // First frame may apply rest poses; audit from frame 1 once settled, but we require
      // ALL frames after warm-up frame 0 to match (REA samples after load).
      dust.update(5 + f / 60, true);
      comets.update(5 + f / 60, true);
      stepCometLaunchEase(launch, samples, 1 / 60, true);
      applyCometLaunchSamples(comets, samples, true);
      if (f === 0) continue; // allow one rest-pose settle frame
      hashes.push(hash(meshSnapshot(scene)));
    }
    const unique = new Set(hashes);
    assert.equal(unique.size, 1, `particles not frozen under reduced after settle: ${unique.size} unique`);
    dust.dispose();
    comets.dispose();
  });

  it("traveler / character / edge / ring / gust / hover stay frozen under reduced", () => {
    const clock = createMotionClock();
    const trails = [
      {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 1, z: 0 },
          { x: 4, y: 0, z: 2 },
        ],
        ease: createTravelerEaseState(0.2),
        sample: createTravelerEaseSample(),
        lastProgress: 0,
      },
    ];
    const charSt = createCharacterMotionState();
    const charOut = createCharacterSample();
    const edgeSt = createEdgePulseState();
    const edgeOut = createEdgePulseSample();
    const ringSt = createFocusRingBreatheState();
    const ringOut = createFocusRingBreatheSample();
    const gustSt = createWindGustState();
    const gustOut = createWindGustSample();
    impulseWindGust(gustSt, 1, 0, 0, false, 1); // impulse while motion on, then freeze
    const tipSt = createHoverTooltipState();
    const tipOut = createHoverTooltipSample();
    setHoverTooltipTarget(tipSt, "bot");
    const hashes: string[] = [];
    for (let f = 0; f < 60; f++) {
      stepTravelerTrails(trails, 8 + f / 60, 1 / 60, true, { clock });
      stepCharacterMotion(charSt, charOut, "c", 8 + f / 60, 1 / 60, true, { speed: 1, lookYaw: 0.4 });
      stepEdgePulseSync(edgeSt, edgeOut, 1, "a", "b", "a", 8 + f / 60, true, { clock });
      stepFocusRingBreathe(ringSt, ringOut, 8 + f / 60, 1 / 60, true, { clock });
      stepWindGust(gustSt, gustOut, 1 / 60, true);
      stepHoverTooltip(tipSt, tipOut, 1 / 60, true);
      const stillPulse = { scale: 1, glow: 2, emissive: 0.5 };
      const stillPos = { x: 0, y: 0, z: 0 };
      const stillSt = createFocusEaseState();
      stepFocusStillTarget(stillSt, stillPulse, stillPos, { x: 3, y: 0, z: 0 }, "x", "x", 8 + f / 60, 0.1, 1 / 60, true, {
        clock,
      });
      hashes.push(
        hash([
          trails[0]!.sample,
          charOut,
          edgeOut,
          ringOut,
          gustOut,
          tipOut,
          stillPulse,
          stillPos,
          stillSt,
        ]),
      );
    }
    const unique = new Set(hashes);
    assert.equal(unique.size, 1, `misc motion helpers not frozen: ${unique.size} unique`);
  });
});
