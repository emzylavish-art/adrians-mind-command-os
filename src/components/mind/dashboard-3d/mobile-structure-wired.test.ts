import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("mobile-structure wiring", () => {
  it("dashboard-app mounts chrome, cards, scene interact, filter sheet trigger", () => {
    const app = readFileSync(join(here, "dashboard-app.tsx"), "utf8");
    assert.match(app, /MobileChrome/);
    assert.match(app, /MobilePanelCard/);
    assert.match(app, /data-scene-interact/);
    assert.match(app, /GraphFiltersPanel triggerOnly/);
    assert.match(app, /dash3d-panel-stack/);
  });

  it("graph filters default closed and expose sheet + Esc/outside close", () => {
    const filters = readFileSync(join(here, "graph-filters-panel.tsx"), "utf8");
    assert.match(filters, /useState\(false\)/);
    assert.match(filters, /graph-filters-sheet/);
    assert.match(filters, /Escape/);
    assert.match(filters, /pointerdown/);
  });

  it("css stacks panels on max-width 720px and uses pan-y when not interacting", () => {
    const css = readFileSync(join(here, "dashboard-3d.css"), "utf8");
    assert.match(css, /@media \(max-width: 720px\)/);
    assert.match(css, /dash3d-mobile-card/);
    assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
    assert.match(css, /data-scene-interact="1"/);
    assert.match(css, /100dvh/);
    assert.match(css, /safe-area-inset/);
  });

  it("universe scene respects scene interact gate on mobile pointerdown", () => {
    const scene = readFileSync(join(here, "universe-scene.tsx"), "utf8");
    assert.match(scene, /sceneInteractOn/);
    assert.match(scene, /data-scene-interact/);
  });
});
