import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSingleFlight } from "./research-flight.ts";

test("second begin while in flight is refused (double-click)", () => {
  const flight = createSingleFlight();
  const first = flight.begin();
  assert.notEqual(first, null);
  assert.equal(flight.begin(), null);
  assert.equal(flight.busy(), true);
});

test("end releases only the matching token", () => {
  const flight = createSingleFlight();
  const first = flight.begin()!;
  flight.end(first + 999);
  assert.equal(flight.busy(), true);
  flight.end(first);
  assert.equal(flight.busy(), false);
  const second = flight.begin();
  assert.notEqual(second, null);
  assert.notEqual(second, first);
});

test("stale token is not current after release and re-begin", () => {
  const flight = createSingleFlight();
  const a = flight.begin()!;
  assert.equal(flight.isCurrent(a), true);
  flight.end(a);
  const b = flight.begin()!;
  assert.equal(flight.isCurrent(a), false);
  assert.equal(flight.isCurrent(b), true);
});

test("double end and end before begin do not throw or unlock a newer run", () => {
  const flight = createSingleFlight();
  flight.end(1);
  const a = flight.begin()!;
  flight.end(a);
  const b = flight.begin()!;
  flight.end(a);
  assert.equal(flight.isCurrent(b), true);
  assert.equal(flight.busy(), true);
});

test("command-app Research button is single-flight and disabled while checking", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const start = src.indexOf("async function startResearch()");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("\n  }\n", start));
  assert.match(body, /researchFlight\.current\.begin\(\)/);
  assert.match(body, /researchFlight\.current\.end\(/);
  assert.match(body, /finally/);
  assert.match(src, /disabled=\{ws\.halted \|\| researchBusy\}/);
});
