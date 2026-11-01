import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = process.cwd();

describe("Gap#52 canvas resize host", () => {
  it("host fills 100dvh and resize uses ResizeObserver + client box", () => {
    const css = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-3d.css"), "utf8");
    const scene = readFileSync(join(root, "src/components/mind/dashboard-3d/universe-scene.tsx"), "utf8");
    assert.match(css, /Gap#52|Gap #52/);
    assert.match(css, /height:\s*100dvh/);
    assert.match(css, /\.dash3d-canvas-wrap\s*\{[^}]*position:\s*absolute/s);
    assert.doesNotMatch(css, /Gap #3[\s\S]{0,120}\.dash3d-canvas-wrap\s*\{\s*position:\s*relative/);
    assert.match(scene, /ResizeObserver/);
    assert.match(scene, /mount\.clientWidth/);
    assert.match(scene, /mount\.clientHeight/);
    assert.match(scene, /resizeObserver\?\.observe\(mount\)/);
  });
});

describe("Gap#53 canvas accessible name", () => {
  it("stage canvas has role=img and live aria-label from bot health counts", () => {
    const scene = readFileSync(join(root, "src/components/mind/dashboard-3d/universe-scene.tsx"), "utf8");
    assert.match(scene, /setAttribute\("role", "img"\)/);
    assert.match(scene, /setAttribute\(\s*"aria-label"/);
    assert.match(scene, /syncCanvasAria/);
    assert.match(scene, /Mind Command 3D stage/);
    assert.match(scene, /data-testid", "dash3d-stage-canvas"/);
  });
});
