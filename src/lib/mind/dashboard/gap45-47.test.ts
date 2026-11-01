import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = process.cwd();

describe("Gap#45 layout CSS", () => {
  it("keeps mirror under skybar and constrains zoomout slabs", () => {
    const css = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-3d.css"), "utf8");
    assert.match(css, /Gap #45/);
    assert.match(css, /\.dash3d-skybar\s*\{[^}]*z-index:\s*7/s);
    assert.match(css, /\.dash3d-mirror-panel\s*\{[^}]*z-index:\s*4/s);
    assert.match(css, /button\.dash3d-zoomout\.dash3d-glass/);
    assert.match(css, /max-height:\s*2\.75rem/);
  });
});

describe("Gap#46 star detail a11y", () => {
  it("marks node-detail as dialog and focuses close; skybar is not a live region", () => {
    const detail = readFileSync(join(root, "src/components/mind/dashboard-3d/node-detail-panel.tsx"), "utf8");
    const app = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-app.tsx"), "utf8");
    assert.match(detail, /role=\{open && \(bot \|\| notionPage\) \? "dialog"/);
    assert.match(detail, /aria-modal=\{open && \(bot \|\| notionPage\) \? true/);
    assert.match(detail, /aria-labelledby=\{open \? "dash3d-node-detail-title"/);
    assert.match(detail, /closeBtnRef\.current\?\.focus/);
    assert.match(detail, /id="dash3d-node-detail-title"/);
    assert.doesNotMatch(app, /dash3d-skybar"[^>]*aria-live="polite"/);
    assert.match(app, /id="dash3d-skybar" role="region"/);
  });
});

describe("Gap#47 focus heap dispose", () => {
  it("tracks and disposes owned portrait textures on rebuild/unmount", () => {
    const scene = readFileSync(join(root, "src/components/mind/dashboard-3d/universe-scene.tsx"), "utf8");
    assert.match(scene, /ownedPortraitTextures/);
    assert.match(scene, /Gap#47/);
    assert.match(scene, /ownedPortraitTextures\.pop/);
    assert.match(scene, /tex\.dispose\(\)/);
  });
});

describe("Gap#58 star-batch tick wire", () => {
  it("universe-scene imports and calls stepStarFieldBatch", () => {
    const scene = readFileSync(join(root, "src/components/mind/dashboard-3d/universe-scene.tsx"), "utf8");
    assert.match(scene, /stepStarFieldBatch/);
    assert.match(scene, /starBatchIds/);
    assert.match(scene, /Gap#58/);
  });
});
