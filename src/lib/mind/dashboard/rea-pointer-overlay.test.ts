/**
 * c55 REA: canvas/CSS2D overlays must not intercept skybar / operator hits;
 * Zoom to sky must force a camera reset; Operator Close must call onOpenChange(false).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const css = readFileSync(join(root, "components/mind/dashboard-3d/dashboard-3d.css"), "utf8");
const app = readFileSync(join(root, "components/mind/dashboard-3d/dashboard-app.tsx"), "utf8");
const op = readFileSync(join(root, "components/mind/dashboard-3d/operator-console.tsx"), "utf8");
const scene = readFileSync(join(root, "components/mind/dashboard-3d/universe-scene.tsx"), "utf8");

describe("c55 REA pointer / operator / zoom", () => {
  it("canvas-wrap overlay children are pointer-events none; canvas + feed glyphs re-enable", () => {
    assert.match(css, /\.dash3d-canvas-wrap\s*>\s*div\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(css, /\.dash3d-canvas-wrap\s+canvas\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(css, /\.dash3d-feed-glyph\s*\{[^}]*pointer-events:\s*auto/s);
  });

  it("operator root is pass-through with panel/backdrop receiving hits", () => {
    assert.match(css, /\.dash3d-operator-root\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(css, /\.dash3d-operator-backdrop\s*,\s*\n?\s*\.dash3d-operator-panel\s*\{[^}]*pointer-events:\s*auto/s);
  });

  it("Operator Close button stops propagation and closes", () => {
    assert.match(op, /data-testid="operator-close"/);
    assert.match(op, /onOpenChange\(false\)/);
    assert.match(op, /stopPropagation\(\)/);
  });

  it("Zoom to sky dispatches dash3d-sky and dash3d-fly SKY", () => {
    assert.match(app, /data-testid="zoom-to-sky"/);
    assert.match(app, /CustomEvent\("dash3d-sky"/);
    assert.match(app, /CustomEvent\("dash3d-fly",[^\n]*SKY/);
  });

  it("onSkyEvent forces UNIVERSE_HIGH lookAt/freePos reset", () => {
    assert.match(scene, /Force a visible camera reset/);
    assert.match(scene, /lookAt\.set\(\.\.\.high\.lookAt\)/);
    assert.match(scene, /freePos\.set\(\.\.\.high\.position\)/);
  });
});
