import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCityLayout, floorsFor, MAX_BUILDINGS, MAX_FLOORS } from "./city-layout.ts";
import {
  CITY_Y,
  FLY_HOME,
  UNIVERSE_HIGH,
  clampCityPan,
  dollyLimits,
  reconcileFlyover,
  reduceFlyover,
  targetForState,
} from "./flyover-fsm.ts";
import type { ProjectBuilding, ProjectsDashboard } from "./projects.ts";

function pb(partial: Partial<ProjectBuilding> & { id: string }): ProjectBuilding {
  return {
    name: partial.id,
    kind: "bot",
    progress: 0,
    progressKnown: false,
    openTasks: 0,
    doneTasks: 0,
    tasks: [],
    recentRuns: [],
    bots: [],
    lastActivityAt: null,
    health: "idle",
    notes: "",
    ...partial,
  };
}

function dash(projects: ProjectBuilding[]): ProjectsDashboard {
  return { available: true, projects, agents: [], generatedAt: "2026-11-01T14:40:00+01:00" };
}

describe("flyover FSM", () => {
  const known = new Set(["project-gap-cycle", "bot-logic"]);

  it("starts high above the universe and dives to the city", () => {
    assert.equal(FLY_HOME.level, "universe");
    const s = reduceFlyover(FLY_HOME, { type: "DIVE" }, known);
    assert.equal(s.level, "city");
  });

  it("cannot enter a building from the sky or an unknown/hostile id", () => {
    assert.equal(reduceFlyover(FLY_HOME, { type: "ENTER", buildingId: "bot-logic" }, known).level, "universe");
    const city = reduceFlyover(FLY_HOME, { type: "DIVE" }, known);
    assert.equal(reduceFlyover(city, { type: "ENTER", buildingId: "../../etc/passwd" }, known), city);
    assert.equal(reduceFlyover(city, { type: "ENTER", buildingId: 42 as unknown as string }, known), city);
  });

  it("enters via door or window floor, then zooms out interior→city→universe", () => {
    let s = reduceFlyover(FLY_HOME, { type: "DIVE" }, known);
    s = reduceFlyover(s, { type: "ENTER", buildingId: "bot-logic", part: "window", floor: 3.7 }, known);
    assert.deepEqual(s, { level: "interior", buildingId: "bot-logic", part: "window", floor: 3 });
    s = reduceFlyover(s, { type: "ZOOM_OUT" }, known);
    assert.equal(s.level, "city");
    s = reduceFlyover(s, { type: "ZOOM_OUT" }, known);
    assert.equal(s.level, "universe");
  });

  it("window floor NaN/Infinity is dropped; SKY always returns home", () => {
    const city = reduceFlyover(FLY_HOME, { type: "DIVE" }, known);
    const s = reduceFlyover(city, { type: "ENTER", buildingId: "bot-logic", part: "window", floor: Number.NaN }, known);
    assert.equal(s.floor, null);
    assert.deepEqual(reduceFlyover(s, { type: "SKY" }, known), FLY_HOME);
  });

  it("wheel at clamps: in at universe dives, out returns above the clouds", () => {
    const city = reduceFlyover(FLY_HOME, { type: "WHEEL_LIMIT", direction: "in" }, known);
    assert.equal(city.level, "city");
    assert.equal(reduceFlyover(city, { type: "WHEEL_LIMIT", direction: "in" }, known), city);
    assert.equal(reduceFlyover(city, { type: "WHEEL_LIMIT", direction: "out" }, known).level, "universe");
    assert.equal(reduceFlyover(FLY_HOME, { type: "WHEEL_LIMIT", direction: "out" }, known), FLY_HOME);
  });

  it("reconciles when the occupied building vanishes from data", () => {
    const inside = { level: "interior" as const, buildingId: "bot-gone", part: "door" as const, floor: null };
    assert.equal(reconcileFlyover(inside, known).level, "city");
    const ok = { ...inside, buildingId: "bot-logic" };
    assert.equal(reconcileFlyover(ok, known), ok);
  });

  it("poses: universe high, city below clouds, interior inside the building", () => {
    const layout = buildCityLayout(dash([pb({ id: "bot-logic", openTasks: 2, doneTasks: 3 })]));
    assert.deepEqual(targetForState(FLY_HOME, layout).position, UNIVERSE_HIGH.position);
    const city = targetForState({ ...FLY_HOME, level: "city" }, layout);
    assert.ok(city.position[1] < -18 && city.lookAt[1] < -30);
    const b = layout.buildings[0]!;
    const inside = targetForState({ level: "interior", buildingId: "bot-logic", part: "door", floor: null }, layout);
    assert.ok(Math.abs(inside.position[0] - b.x) < b.width / 2);
    assert.ok(inside.position[1] > CITY_Y && inside.position[1] < CITY_Y + b.height);
    assert.equal(inside.subjectId, "bot-logic");
    // missing building → city pose (no NaN camera)
    const ghost = targetForState({ level: "interior", buildingId: "nope", part: "door", floor: null }, layout);
    assert.equal(ghost.level, "city");
    for (const v of [...ghost.position, ...ghost.lookAt]) assert.ok(Number.isFinite(v));
  });

  it("clamps pan and has sane dolly limits", () => {
    const layout = buildCityLayout(dash([pb({ id: "a" })]));
    const [x, z] = clampCityPan(1e9, Number.NaN, layout);
    assert.ok(Number.isFinite(x) && x < 100 && z === 0);
    for (const l of ["universe", "city", "interior"] as const) {
      const [mn, mx] = dollyLimits(l);
      assert.ok(mn > 0 && mx > mn);
    }
  });
});

describe("city layout adapter (real data only)", () => {
  it("unknown progress lights zero floors (no fake progress)", () => {
    const layout = buildCityLayout(dash([pb({ id: "bot-x", health: "healthy", progress: 0.55, progressKnown: false, openTasks: 1 })]));
    assert.equal(layout.buildings[0]!.litFloors, 0);
    assert.equal(layout.buildings[0]!.progress, 0);
  });

  it("known progress lights floors proportional to real done/total", () => {
    const layout = buildCityLayout(
      dash([pb({ id: "project-gap-cycle", kind: "project", progress: 0.5, progressKnown: true, openTasks: 3, doneTasks: 3 })]),
    );
    const b = layout.buildings[0]!;
    assert.equal(b.floors, 6);
    assert.equal(b.litFloors, 3);
  });

  it("puts projects first, caps buildings/floors, dedupes ids, survives garbage", () => {
    const many = Array.from({ length: 80 }, (_, i) => pb({ id: `bot-${i}`, openTasks: 1e6 }));
    many.push(pb({ id: "bot-1" }));
    many.push(pb({ id: "project-z", kind: "project" }));
    many.push(pb({ id: "bot-nan", progress: Number.NaN, progressKnown: true, health: "purple" as never }));
    const layout = buildCityLayout(dash(many));
    assert.ok(layout.buildings.length <= MAX_BUILDINGS);
    assert.equal(new Set(layout.buildings.map((b) => b.id)).size, layout.buildings.length);
    assert.ok(layout.buildings.every((b) => b.floors <= MAX_FLOORS && Number.isFinite(b.x) && Number.isFinite(b.z)));
    const tagged = buildCityLayout(dash([pb({ id: "bot-nan", progress: Number.NaN, progressKnown: true, health: "purple" as never }), pb({ id: "project-z", kind: "project" })]));
    assert.equal(tagged.buildings[0]!.kind, "project");
    const nan = tagged.buildings.find((b) => b.id === "bot-nan")!;
    assert.equal(nan.health, "idle");
    assert.equal(nan.litFloors, 0);
  });

  it("honest unavailable when projects missing or empty", () => {
    assert.equal(buildCityLayout(null).available, false);
    assert.equal(buildCityLayout(dash([])).available, false);
    assert.equal(floorsFor({ kind: "bot", openTasks: -5, doneTasks: Number.NaN, recentRuns: [] }), 1);
  });
});
