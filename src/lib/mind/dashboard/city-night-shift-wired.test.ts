import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCityLayout } from "./city-layout.ts";

describe("city night-shift wiring (c65)", () => {
  it("buildCityLayout marks night floors from real lastActivityAt", () => {
    const now = Date.parse("2026-11-02T23:00:00+01:00");
    const proj = {
      available: true,
      reason: null,
      projects: [
        {
          id: "bot-a",
          name: "A",
          kind: "bot",
          health: "healthy",
          openTasks: 3,
          doneTasks: 3,
          recentRuns: [],
          tasks: [],
          progress: 0.5,
          progressKnown: true,
          lastActivityAt: new Date(now - 60_000).toISOString(),
        },
      ],
    } as never;
    const layout = buildCityLayout(proj, { nowMs: now, reducedMotion: false });
    const b = layout.buildings[0]!;
    assert.equal(b.nightShiftActive, true);
    assert.ok(b.nightShiftFloors.length > 0);
    const rm = buildCityLayout(proj, { nowMs: now, reducedMotion: true });
    assert.equal(rm.buildings[0]!.nightShiftSteady, true);
  });

  it("universe-scene passes nowMs + reducedMotion into buildCityLayout", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../../components/mind/dashboard-3d/universe-scene.tsx"), "utf8");
    assert.match(src, /buildCityLayout\(dataRef\.current\.projects,\s*\{\s*nowMs:\s*Date\.now\(\),\s*reducedMotion\s*\}\)/);
  });
});
