import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_PREFS } from "./operator-palette.ts";
import {
  findUnsafeFirstPaintInitializers,
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

  it("Gap#65 detects useRef/useState window/matchMedia initializers", () => {
    const bad = `
      const reduced = useRef(
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    `;
    const hits = findUnsafeFirstPaintInitializers(bad);
    assert.ok(hits.some((h) => /useRef/.test(h)), hits.join(","));
    assert.deepEqual(findUnsafeFirstPaintInitializers("const reduced = useRef(false);"), []);
  });

  it("DashboardApp first-render paths avoid client-only reads", () => {
    const src = readFileSync(new URL("../../../components/mind/dashboard-3d/dashboard-app.tsx", import.meta.url), "utf8");
    assert.match(src, /useState\(false\)/);
    assert.doesNotMatch(
      src,
      /const reducedMotion = useMemo\(\(\)\s*=>\s*\{[\s\S]*matchMedia/,
    );
    assert.doesNotMatch(src, /useState<OperatorPrefs>\(\(\)\s*=>\s*loadInitialOperatorPrefs\(\)\)/);
    assert.doesNotMatch(src, /let dash3dStagePrimed/);
    assert.match(src, /setStagePrimed\(true\)/);
    assert.deepEqual(findUnsafeFirstPaintInitializers(src), []);
  });

  it("FlyoverHud does not read matchMedia in useRef init (Gap#65)", () => {
    const src = readFileSync(new URL("../../../components/mind/dashboard-3d/flyover-hud.tsx", import.meta.url), "utf8");
    assert.deepEqual(findUnsafeFirstPaintInitializers(src), []);
    assert.match(src, /useRef\(false\)/);
    assert.match(src, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  });

  it("dashboard route mounts app only after hydrate (Gap#65)", () => {
    const src = readFileSync(new URL("../../../routes/dashboard.tsx", import.meta.url), "utf8");
    assert.match(src, /useState\(false\)/);
    assert.match(src, /setMounted\(true\)/);
    assert.match(src, /if \(!mounted\) return/);
  });
});
