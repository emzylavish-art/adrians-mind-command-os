/**
 * Hacker c16 — CPU-only per-frame budget (not SwiftShader fps).
 * Realistic counts × 10k frames; assert mean motion CPU < ~2ms/frame.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import { type PulseSample } from "./star-pulse.ts";
import { type Xyz } from "./orbit-drift.ts";
import { createFocusEaseState } from "./focus-ease.ts";
import {
  createCharacterMotionState,
  createCharacterSample,
  stepCharacterMotion,
} from "./character-motion.ts";
import {
  createTravelerEaseState,
  createTravelerEaseSample,
  stepTravelerEase,
} from "./traveler-ease.ts";
import {
  createCometLaunchState,
  createCometLaunchSample,
  scheduleCometLaunchBurst,
  stepCometLaunchEase,
} from "./comet-launch-ease.ts";
import {
  createEdgePulseState,
  createEdgePulseSample,
  stepEdgePulseSync,
} from "./edge-pulse-sync.ts";
import {
  createHoverTooltipState,
  createHoverTooltipSample,
  setHoverTooltipTarget,
  stepHoverTooltip,
} from "./hover-tooltip-motion.ts";
import {
  createBreadcrumbEaseState,
  createBreadcrumbEaseSample,
  setBreadcrumbFocus,
  stepBreadcrumbEase,
} from "./breadcrumb-ease.ts";
import {
  createFocusRingBreatheState,
  createFocusRingBreatheSample,
  setFocusRingActive,
  stepFocusRingBreathe,
} from "./focus-ring-breathe.ts";
import {
  createWindGustState,
  createWindGustSample,
  impulseWindGust,
  stepWindGust,
} from "./wind-gust.ts";
import {
  createNodeOpenState,
  createNodeOpenSample,
  setNodeOpen,
  stepNodeOpen,
  createSceneTransitionState,
  createSceneTransitionSample,
  beginSceneTransition,
  stepSceneTransition,
} from "./transition-ease.ts";
import { stepStarFieldBatch } from "./star-batch.ts";

const STARS = 500;
const DUST = 2000;
const COMETS = 20;
const TRAVELERS = 50;
const CHARS = 30;
const EDGES = 80;
const FRAMES = 10_000;
const DT = 1 / 60;
const MEAN_BUDGET_MS = 2.0;

type DustSeed = { x: number; y: number; z: number; phase: number; speed: number; amp: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

describe("hacker c16 — CPU per-frame motion budget", () => {
  it("10k frames @ realistic counts stay under ~2ms mean (CPU-only)", () => {
    const clock = createMotionClock();
    const healths = ["healthy", "stalled", "blocked", "idle"] as const;

    // Stars
    const pulseOuts: PulseSample[] = Array.from({ length: STARS }, () => ({ scale: 1, glow: 2, emissive: 0.7 }));
    const posOuts: Xyz[] = Array.from({ length: STARS }, () => ({ x: 0, y: 0, z: 0 }));
    const healthArr = Array.from({ length: STARS }, (_, i) => healths[i & 3]!);
    const bases: Xyz[] = [];
    const focusStates = [];
    const starIds: string[] = [];
    for (let i = 0; i < STARS; i++) {
      starIds.push(`bot:${i}`);
      bases.push({ x: (i % 50) * 0.4, y: (i % 7) * 0.1, z: (i % 30) * 0.3 });
      focusStates.push(createFocusEaseState());
    }

    // Dust (CPU wobble only — no Three.js)
    const dust: DustSeed[] = [];
    for (let i = 0; i < DUST; i++) {
      dust.push({
        x: Math.sin(i) * 20,
        y: (i % 17) - 8,
        z: Math.cos(i * 0.7) * 20,
        phase: i * 0.01,
        speed: 0.15 + (i % 10) * 0.03,
        amp: 0.1 + (i % 5) * 0.02,
      });
    }
    let dustX = 0; // prevent DCE

    // Characters
    const charStates = Array.from({ length: CHARS }, () => createCharacterMotionState());
    const charOuts = Array.from({ length: CHARS }, () => createCharacterSample());

    // Travelers
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
      { x: 8, y: 0, z: 6 },
    ];
    const travStates = Array.from({ length: TRAVELERS }, (_, i) => createTravelerEaseState(i * 0.02));
    const travOuts = Array.from({ length: TRAVELERS }, () => createTravelerEaseSample());

    // Comet launch
    const launch = createCometLaunchState(COMETS);
    scheduleCometLaunchBurst(launch, COMETS, false, { maxConcurrent: 6 });
    const launchOut = Array.from({ length: COMETS }, () => createCometLaunchSample());

    // Edges
    const edgeSt = Array.from({ length: EDGES }, () => createEdgePulseState());
    const edgeOut = Array.from({ length: EDGES }, () => createEdgePulseSample());

    // HUD oneshots
    const hover = createHoverTooltipState();
    const hoverOut = createHoverTooltipSample();
    setHoverTooltipTarget(hover, "bot:1");
    const bc = createBreadcrumbEaseState();
    const bcOut = createBreadcrumbEaseSample();
    setBreadcrumbFocus(bc, "bot:1");
    const ring = createFocusRingBreatheState();
    const ringOut = createFocusRingBreatheSample();
    setFocusRingActive(ring, true);
    const gust = createWindGustState();
    const gustOut = createWindGustSample();
    impulseWindGust(gust, 1, 0.2, 0, false, 0.5);
    const node = createNodeOpenState(false);
    setNodeOpen(node, true);
    const nodeOut = createNodeOpenSample();
    const sceneTx = createSceneTransitionState();
    beginSceneTransition(sceneTx, "universe", "city");
    const sceneOut = createSceneTransitionSample();

    const focusId = "bot:42";
    const times: number[] = [];
    const heap0 = process.memoryUsage().heapUsed;

    for (let f = 0; f < FRAMES; f++) {
      const t0 = performance.now();
      const wall = f * DT;
      const t = clock.map(wall);

      stepStarFieldBatch(
        starIds, healthArr, bases, focusStates, pulseOuts, posOuts,
        focusId, wall, DT, false, STARS, { clock },
      );

      for (let i = 0; i < DUST; i++) {
        const s = dust[i]!;
        const wobble = Math.sin(t * s.speed + s.phase) * s.amp;
        dustX += s.x + wobble * 0.4 + gustOut.x;
      }

      for (let i = 0; i < CHARS; i++) {
        stepCharacterMotion(charStates[i]!, charOuts[i]!, `char:${i}`, wall, DT, false, {
          clock,
          speed: i % 3 === 0 ? 1 : 0,
        });
      }

      for (let i = 0; i < TRAVELERS; i++) {
        stepTravelerEase(travStates[i]!, travOuts[i]!, path, wall, DT, false, { clock });
      }

      stepCometLaunchEase(launch, launchOut, DT, false);
      if (f % 120 === 0) scheduleCometLaunchBurst(launch, 4, false, { maxConcurrent: 6 });

      for (let i = 0; i < EDGES; i++) {
        stepEdgePulseSync(
          edgeSt[i]!,
          edgeOut[i]!,
          0.8,
          `a${i}`,
          `b${i}`,
          focusId,
          wall,
          false,
          { clock },
        );
      }

      stepHoverTooltip(hover, hoverOut, DT, false);
      stepBreadcrumbEase(bc, bcOut, DT, false);
      stepFocusRingBreathe(ring, ringOut, wall, DT, false, { clock });
      stepWindGust(gust, gustOut, DT, false);
      stepNodeOpen(node, nodeOut, DT, false);
      stepSceneTransition(sceneTx, sceneOut, DT, false);

      times.push(performance.now() - t0);
    }

    const heap1 = process.memoryUsage().heapUsed;
    const sorted = times.slice().sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const mean = sum / times.length;
    const report = {
      frames: FRAMES,
      stars: STARS,
      dust: DUST,
      comets: COMETS,
      travelers: TRAVELERS,
      characters: CHARS,
      edges: EDGES,
      meanMs: mean,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: sorted[sorted.length - 1],
      heapDeltaMB: (heap1 - heap0) / (1024 * 1024),
      dustSink: dustX, // keep live
    };
    // eslint-disable-next-line no-console
    console.log("CPU_BUDGET_C16", JSON.stringify(report));

    assert.ok(mean < MEAN_BUDGET_MS, `mean ${mean.toFixed(3)}ms >= ${MEAN_BUDGET_MS}ms budget`);
    assert.ok(Number.isFinite(report.p99Ms));
  });
});
