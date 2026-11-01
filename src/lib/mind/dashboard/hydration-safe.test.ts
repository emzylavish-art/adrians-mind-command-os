import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_PREFS } from "./operator-palette.ts";
import {
  firstPaintOperatorPrefs,
  firstPaintReducedMotion,
  isUnsafeFirstPaintSource,
} from "./hydration-safe.ts";

describe("hydration-safe first paint (DashboardApp / UniverseScene)", () => {
  it("first-paint helpers are deterministic (no window/Date/random)", () => {
    assert.equal(firstPaintReducedMotion(), false);
    const a = firstPaintOperatorPrefs(DEFAULT_PREFS);
    const b = firstPaintOperatorPrefs(DEFAULT_PREFS);
    assert.deepEqual(a, b);
    assert.notEqual(a.layers, DEFAULT_PREFS.layers); // copied
  });

  it("flags client-only sources that must not run during first render", () => {
    assert.equal(isUnsafeFirstPaintSource("Date.now()"), true);
    assert.equal(isUnsafeFirstPaintSource("window.matchMedia(q)"), true);
    assert.equal(isUnsafeFirstPaintSource("localStorage.getItem(k)"), true);
    assert.equal(isUnsafeFirstPaintSource("Math.random()"), true);
    assert.equal(isUnsafeFirstPaintSource("const x = 1"), false);
  });

  it("DashboardApp first-render paths avoid client-only reads", () => {
    const src = readFileSync(new URL("../../../components/mind/dashboard-3d/dashboard-app.tsx", import.meta.url), "utf8");
    // reducedMotion must start as useState(false), not matchMedia in render
    assert.match(src, /useState\(false\)/);
    assert.doesNotMatch(
      src,
      /const reducedMotion = useMemo\(\(\)\s*=>\s*\{[\s\S]*matchMedia/,
    );
    // operator prefs must not use loadInitialOperatorPrefs as useState initializer
    assert.doesNotMatch(src, /useState<OperatorPrefs>\(\(\)\s*=>\s*loadInitialOperatorPrefs\(\)\)/);
    // no module-level dash3dStagePrimed mutate during render
    assert.doesNotMatch(src, /let dash3dStagePrimed/);
    assert.match(src, /setStagePrimed\(true\)/);
  });
});
