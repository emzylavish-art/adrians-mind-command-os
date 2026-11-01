import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createTunedBloomPass } from "./bloom-tuning.ts";
import { createContextLossRecovery } from "./context-loss.ts";
import { markDepthClobbered } from "./depth-validity.ts";
import { FOCUS_BAND, FOCUS_RAMP } from "./focus-depth.ts";
import {
  BLOOM_GUARD_EASE_MS,
  BLOOM_GUARD_MAX,
  BLOOM_GUARD_RADIUS,
  BLOOM_GUARD_RADIUS_MAX,
  BLOOM_GUARD_RADIUS_MIN,
  bloomGuardKeepDepth,
  bloomGuardKeepRadial,
  clampGuardRadius,
  createFocusBloomGuard,
  projectedRadiusUv,
} from "./focus-bloom-guard.ts";

const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
const origin = () => new THREE.Vector3(0, 0, 0);

function bloomWithSpy() {
  const handle = createTunedBloomPass(new THREE.Vector2(64, 36), "healthy");
  const seen: Array<{ material: unknown; useDepth: unknown; tDepth: unknown }> = [];
  // Stub the GPU work: record what the high-pass sees during render.
  const pass = handle.pass;
  pass.render = (() => {
    const hu = pass.highPassUniforms as Record<string, { value: unknown }>;
    seen.push({ material: pass.materialHighPassFilter, useDepth: hu.useDepth?.value, tDepth: hu.tDepth?.value });
  }) as typeof pass.render;
  return { handle, seen };
}

describe("focus-aware bloom guard (queue #57)", () => {
  it("depth mirror: suppress in band, full bloom past band+ramp, junk → keep", () => {
    assert.equal(bloomGuardKeepDepth(0.5, 0.5, BLOOM_GUARD_MAX), 1 - BLOOM_GUARD_MAX);
    assert.equal(bloomGuardKeepDepth(0.5 + FOCUS_BAND + FOCUS_RAMP, 0.5, BLOOM_GUARD_MAX), 1);
    assert.equal(bloomGuardKeepDepth(0.5, 0.5, 0), 1, "no guard = original bloom");
    assert.equal(bloomGuardKeepDepth(Number.NaN, 0.5, 1), 1);
    assert.equal(bloomGuardKeepDepth(0.5, 0.5, 9), 0, "guard clamps to 1");
  });

  it("radial mirror: crisp disc around focus, background untouched", () => {
    assert.equal(bloomGuardKeepRadial(0, BLOOM_GUARD_MAX), 1 - BLOOM_GUARD_MAX);
    assert.equal(bloomGuardKeepRadial(BLOOM_GUARD_RADIUS + 0.5, BLOOM_GUARD_MAX), 1);
    const mid = bloomGuardKeepRadial(BLOOM_GUARD_RADIUS + 0.07, BLOOM_GUARD_MAX);
    assert.ok(mid > 1 - BLOOM_GUARD_MAX && mid < 1);
    assert.equal(bloomGuardKeepRadial(Number.POSITIVE_INFINITY, 1), 1);
  });

  it("radius clamp + projected radius from node/card bounds", () => {
    assert.equal(clampGuardRadius(undefined), BLOOM_GUARD_RADIUS);
    assert.equal(clampGuardRadius(Number.NaN), BLOOM_GUARD_RADIUS);
    assert.equal(clampGuardRadius(-1), BLOOM_GUARD_RADIUS);
    assert.equal(clampGuardRadius(0.001), BLOOM_GUARD_RADIUS_MIN);
    assert.equal(clampGuardRadius(5), BLOOM_GUARD_RADIUS_MAX);
    const c = cam();
    const near = projectedRadiusUv(origin(), 1, c)!;
    c.position.set(0, 0, 30);
    c.updateMatrixWorld();
    const far = projectedRadiusUv(origin(), 1, c)!;
    assert.ok(near > far, "closer card → bigger guard disc");
    assert.equal(projectedRadiusUv(new THREE.Vector3(0, 0, 50), 1, c), null, "behind camera");
    assert.equal(projectedRadiusUv(origin(), Number.NaN, c), null);
    assert.equal(projectedRadiusUv(origin(), 1, new THREE.OrthographicCamera()), null);
  });

  it("no focus → original high-pass material, zero cost", () => {
    const { handle, seen } = bloomWithSpy();
    const orig = handle.pass.materialHighPassFilter;
    const guard = createFocusBloomGuard(handle);
    assert.equal(guard.active, false);
    handle.pass.render({} as never, null as never, new THREE.WebGLRenderTarget(4, 4), 0, false);
    assert.equal(seen[0].material, orig);
    guard.setFocus(null, cam());
    assert.equal(guard.guard, 0);
    assert.equal(handle.pass.materialHighPassFilter, orig);
  });

  it("focus eases guard in; reduced motion snaps; clear eases out and restores", () => {
    const { handle } = bloomWithSpy();
    const orig = handle.pass.materialHighPassFilter;
    const guard = createFocusBloomGuard(handle);
    guard.setFocus(origin(), cam());
    guard.tick(BLOOM_GUARD_EASE_MS / 2);
    assert.ok(guard.guard > 0 && guard.guard < BLOOM_GUARD_MAX);
    assert.notEqual(handle.pass.materialHighPassFilter, orig);
    guard.setFocus(origin(), cam()); // per-frame same focus must not restart the ease
    guard.tick(BLOOM_GUARD_EASE_MS / 2);
    assert.equal(guard.guard, BLOOM_GUARD_MAX);
    guard.setFocus(null, cam(), { reducedMotion: true });
    assert.equal(guard.guard, 0, "reduced motion snaps off");
    assert.equal(handle.pass.materialHighPassFilter, orig);
    guard.setFocus(origin(), cam(), { reducedMotion: true });
    assert.equal(guard.guard, BLOOM_GUARD_MAX, "reduced motion snaps on (static)");
  });

  it("junk / behind-camera focus → no guard", () => {
    const { handle } = bloomWithSpy();
    const guard = createFocusBloomGuard(handle);
    guard.setFocus(new THREE.Vector3(Number.NaN, 0, 0), cam(), { reducedMotion: true });
    assert.equal(guard.guard, 0);
    guard.setFocus(new THREE.Vector3(0, 0, 40), cam(), { reducedMotion: true });
    assert.equal(guard.guard, 0);
  });

  it("render: real depth when valid, radial when focus-depth just clobbered it; always unbinds", () => {
    const { handle, seen } = bloomWithSpy();
    const guard = createFocusBloomGuard(handle);
    guard.setFocus(origin(), cam(), { reducedMotion: true });
    const rb = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
    const renderer = { info: { render: { frame: 7 } } };
    handle.pass.render(renderer as never, null as never, rb, 0, false);
    assert.equal(seen.at(-1)!.useDepth, 1);
    assert.equal(seen.at(-1)!.tDepth, rb.depthTexture);
    markDepthClobbered(renderer, rb); // focus-depth wrote rb in the preceding call
    handle.pass.render(renderer as never, null as never, rb, 0, false);
    assert.equal(seen.at(-1)!.useDepth, 0, "flat depth → radial mask");
    const hu = handle.pass.highPassUniforms as Record<string, { value: unknown }>;
    assert.equal(hu.tDepth.value, null, "depth unbound after draw");
  });

  it("dispose restores original material/render; bloom dispose first also frees guard", () => {
    const { handle } = bloomWithSpy();
    const orig = handle.pass.materialHighPassFilter;
    const stubRender = handle.pass.render;
    const guard = createFocusBloomGuard(handle);
    guard.setFocus(origin(), cam(), { reducedMotion: true });
    guard.dispose();
    assert.equal(handle.pass.materialHighPassFilter, orig);
    assert.equal(handle.pass.render, stubRender);
    assert.equal(guard.guard, 0);
    guard.setFocus(origin(), cam(), { reducedMotion: true }); // no-op after dispose
    assert.equal(guard.active, false);

    const b2 = bloomWithSpy();
    const orig2 = b2.handle.pass.materialHighPassFilter;
    const g2 = createFocusBloomGuard(b2.handle.pass);
    g2.setFocus(origin(), cam(), { reducedMotion: true });
    let origDisposed = false;
    orig2.addEventListener("dispose", () => (origDisposed = true));
    b2.handle.dispose(); // bloom first (e.g. context loss)
    assert.equal(g2.active, false);
    assert.equal(origDisposed, true, "original high-pass material freed, not leaked");
  });

  it("tuned bloom dispose frees the high-pass material even without a guard (upstream leak)", () => {
    const h = createTunedBloomPass(new THREE.Vector2(8, 8));
    let freed = false;
    h.pass.materialHighPassFilter.addEventListener("dispose", () => (freed = true));
    h.dispose();
    assert.equal(freed, true);
  });

  it("context-loss bundle disposes the guard and rebuilds it via factory", () => {
    const { handle } = bloomWithSpy();
    const guard = createFocusBloomGuard(handle);
    guard.setFocus(origin(), cam(), { reducedMotion: true });
    let rebuilt = 0;
    const rec = createContextLossRecovery({
      initial: { bloom: handle, focusBloomGuard: guard },
      factory: () => {
        rebuilt++;
        const b = createTunedBloomPass(new THREE.Vector2(8, 8));
        return { bloom: b, focusBloomGuard: createFocusBloomGuard(b) };
      },
    });
    rec.notifyLost();
    assert.equal(guard.active, false);
    assert.equal(rec.bundle.focusBloomGuard, null);
    rec.notifyRestored();
    assert.equal(rebuilt, 1);
    assert.ok(rec.bundle.focusBloomGuard);
    rec.dispose();
  });
});
