import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("mobile structure wiring", () => {
  it("mounts one orbit toggle inside mobile chrome, the filter sheet, and the plain list", () => {
    const app = readFileSync(join(here, "dashboard-app.tsx"), "utf8");
    assert.match(app, /MobileChrome/);
    assert.match(app, /MobilePanelCard/);
    assert.match(app, /data-scene-interact/);
    assert.match(app, /GraphFiltersPanel triggerOnly/);
    assert.match(app, /dash3d-panel-stack/);
    assert.match(app, /dash3d-plain-fallback/);
    assert.ok(app.includes("!narrow || sceneInteract"));
    assert.match(app, /data-hud-card/);
    assert.equal((app.match(/data-testid="scene-interact"/g) ?? []).length, 0);
    assert.match(readFileSync(join(here, "mobile-structure.tsx"), "utf8"), /data-testid="scene-interact"/);
    assert.match(readFileSync(join(here, "mobile-structure.tsx"), "utf8"), /Orbit off/);
  });

  it("makes the dashboard route public while retaining the session-gate implementation for protected flows", () => {
    const route = readFileSync(join(here, "../../../routes/dashboard.tsx"), "utf8");
    const gate = readFileSync(join(here, "../../../lib/mind/dashboard/require-dashboard-user.ts"), "utf8");
    assert.doesNotMatch(route, /requireDashboardUser/);
    assert.match(route, /Public read-only dashboard/);
    assert.match(gate, /getSessionUser/);
    assert.equal(gate.includes("requireUserId"), false);
  });

  it("css stacks cards, parks orbit, and uses the approved restrained accent", () => {
    const css = readFileSync(join(here, "dashboard-3d.css"), "utf8");
    assert.match(css, /@media \(max-width: 720px\)/);
    assert.match(css, /dash3d-mobile-card/);
    assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
    assert.match(css, /data-scene-interact="1"/);
    assert.match(css, /100dvh/);
    assert.match(css, /safe-area-inset/);
    assert.match(css, /--dash3d-accent/);
  });

  it("scene pointerdown honors the mobile interact gate and bloom can turn off", () => {
    const scene = readFileSync(join(here, "universe-scene.tsx"), "utf8");
    assert.match(scene, /sceneInteractOn/);
    assert.match(scene, /data-scene-interact/);
    assert.match(scene, /bloomTier/);
    assert.match(scene, /tier !== "off"/);
  });
});
