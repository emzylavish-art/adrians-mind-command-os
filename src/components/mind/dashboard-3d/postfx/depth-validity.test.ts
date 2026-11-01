import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createFocusDepthPass } from "./focus-depth.ts";
import { createGodRayPass } from "./god-rays.ts";
import { isDepthClobbered, liveSceneDepth, markDepthClobbered } from "./depth-validity.ts";

/** Minimal renderer: every render() bumps info.render.frame like WebGLRenderer. */
function mockRenderer(onRender?: () => void) {
  return {
    info: { render: { frame: 0 } },
    setRenderTarget() {},
    clear() {},
    render() {
      this.info.render.frame++;
      onRender?.();
    },
  };
}

function targets() {
  const T = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
  const U = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
  return { T, U };
}

const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

describe("scene depth validity across composer ping-pong (hacker)", () => {
  it("focus-depth after god-rays does NOT sample the swapped target's flat depth", () => {
    const { T, U } = targets();
    const rays = createGodRayPass({ healthy: 3, total: 3, reducedMotion: false });
    const focus = createFocusDepthPass();
    focus.setFocus(new THREE.Vector3(0, 0, 0), cam(), { reducedMotion: true });
    const fu = focus.pass.uniforms as Record<string, { value: unknown }>;
    const seen: { use?: unknown; tex?: unknown; drew?: boolean } = {};
    let phase = "";
    const r = mockRenderer(() => {
      if (phase === "focus") Object.assign(seen, { drew: true, use: fu.useDepth.value, tex: fu.tDepth.value });
    });
    r.render(); // RenderPass → T has real scene depth
    phase = "rays";
    rays.pass.render(r as never, U, T, 0, false); // reads T, writes U (clobbers U depth), swap
    phase = "focus";
    focus.pass.render(r as never, T, U, 0, false); // reads U: flat quad depth
    assert.ok(seen.drew, "focus pass drew");
    assert.equal(seen.use, 0, "flat depth must fall back to radial mask");
    assert.equal(seen.tex, null);
  });

  it("first depth consumer after RenderPass keeps real scene depth", () => {
    const { T, U } = targets();
    const focus = createFocusDepthPass();
    focus.setFocus(new THREE.Vector3(0, 0, 0), cam(), { reducedMotion: true });
    const fu = focus.pass.uniforms as Record<string, { value: unknown }>;
    let seen: unknown = null;
    let phase = "";
    const r = mockRenderer(() => {
      if (phase === "focus") seen = fu.tDepth.value;
    });
    // previous frame: focus wrote T long ago → stale mark must not match
    markDepthClobbered(r, U);
    r.render(); // RenderPass into U
    phase = "focus";
    focus.pass.render(r as never, T, U, 0, false);
    assert.equal(seen, U.depthTexture);
    assert.equal(fu.tDepth.value, null, "unbound after draw (feedback guard)");
  });

  it("helpers: junk-safe, sticky only when target has no depth attachment", () => {
    const { T } = targets();
    const sticky = new THREE.DepthTexture(4, 4);
    const r = mockRenderer();
    assert.equal(isDepthClobbered(null, T), false);
    assert.equal(isDepthClobbered(r, null), false);
    markDepthClobbered({}, T); // no info → ignored
    assert.equal(liveSceneDepth(r, T, sticky), T.depthTexture);
    markDepthClobbered(r, T);
    assert.equal(liveSceneDepth(r, T, sticky), null);
    r.render();
    assert.equal(liveSceneDepth(r, T, sticky), T.depthTexture, "stale mark expires");
    assert.equal(liveSceneDepth(r, { depthTexture: null }, sticky), sticky);
    // a different renderer (context restore → new info) never matches
    markDepthClobbered(r, T);
    assert.equal(isDepthClobbered({ info: { render: { frame: r.info.render.frame } } }, T), false);
  });
});
