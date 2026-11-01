import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, type RegionReader } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass, type UvRect } from "./detail-backdrop-dim.ts";
import { createCardEdgePass } from "./card-edge.ts";
import { BLOOM_GUARD_RADIUS_MAX, BLOOM_GUARD_RADIUS_MIN, clampGuardRadius, projectedRadiusUv } from "./focus-bloom-guard.ts";

/**
 * Hacker pass (cycle after #93): the #93 hacker fix made the card probe use
 * the "real" projected radius — but the live scene gets that radius from
 * projectedRadiusUv(), which itself ran clampGuardRadius() and returned
 * [0.04, 0.45]. So in the wired dashboard:
 *  - a far (tiny) Imagine card was still metered at 0.04 (up to ~4× its real
 *    radius, ~16× the area — mostly backdrop) and reported as `contrast.card`,
 *    which drives the #83/#84 key lift;
 *  - a close-up card (> 0.45) got the #93 rim drawn at 0.45, i.e. a light/shade
 *    ring cutting across the card face instead of sitting outside it.
 * projectedRadiusUv must return the real (padded) radius; every guard/hole/lift
 * consumer already clamps it itself with clampGuardRadius.
 */
const CARD_R_WORLD = 1.2; // universe-scene cardRadiusWorld
const camAt = (z: number) => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  c.position.set(0, 0, z);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
/** Expected real padded radius (screen-height fraction) at distance z. */
const realR = (z: number) => (CARD_R_WORLD / (2 * z * Math.tan(THREE.MathUtils.degToRad(50) / 2))) * 1.15;
const origin = () => new THREE.Vector3(0, 0, 0);
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1600, height: 900 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("hacker: projectedRadiusUv returns the real radius (no guard clamp)", () => {
  it("far card below the guard minimum → real radius, not 0.04", () => {
    const r = projectedRadiusUv(origin(), CARD_R_WORLD, camAt(80));
    assert.ok(r !== null);
    assert.ok(realR(80) < BLOOM_GUARD_RADIUS_MIN, "fixture really is below the clamp");
    assert.ok(Math.abs(r! - realR(80)) < 1e-9, `got ${r}, real ${realR(80)}`);
  });

  it("close-up card above the guard maximum → real radius, not 0.45", () => {
    const r = projectedRadiusUv(origin(), CARD_R_WORLD, camAt(2));
    assert.ok(realR(2) > BLOOM_GUARD_RADIUS_MAX, "fixture really is above the clamp");
    assert.ok(Math.abs(r! - realR(2)) < 1e-9, `got ${r}, real ${realR(2)}`);
  });

  it("wired path: far card probe meters its real size (not the 0.04 clamp)", async () => {
    let t = 0;
    const calls: UvRect[][] = [];
    const reader: RegionReader = {
      async read(_r, _s, rects) {
        calls.push(rects.map((x) => [...x] as UvRect));
        return rects.map(() => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(10));
      },
      dispose() {},
    };
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    const c = camAt(80);
    h.setHole(origin(), c, projectedRadiusUv(origin(), CARD_R_WORLD, c)); // exactly as universe-scene does
    h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(calls.length, 1);
    const p = calls[0]![0]!;
    assert.ok(Math.abs(p[3] - p[1] - 2 * realR(80)) < 1e-6, `probe height ${p[3] - p[1]} vs real 2r ${2 * realR(80)}`);
    h.dispose();
  });

  it("wired path: close-up card rim sits at the real card bound (outside the face)", () => {
    const edge = createCardEdgePass();
    const c = camAt(2);
    edge.setFocus(origin(), c, projectedRadiusUv(origin(), CARD_R_WORLD, c));
    const u = edge.pass.uniforms as unknown as { radius: { value: number } };
    assert.ok(Math.abs(u.radius.value - Math.min(1, realR(2))) < 1e-9, `rim radius ${u.radius.value} vs real ${realR(2)}`);
    edge.dispose();
  });

  it("guard / hole consumers still clamp the real radius themselves", () => {
    const far = projectedRadiusUv(origin(), CARD_R_WORLD, camAt(80))!;
    const near = projectedRadiusUv(origin(), CARD_R_WORLD, camAt(2))!;
    assert.equal(clampGuardRadius(far), BLOOM_GUARD_RADIUS_MIN);
    assert.equal(clampGuardRadius(near), BLOOM_GUARD_RADIUS_MAX);
    const h = createDetailBackdropDimPass({ reader: { async read() { return []; }, dispose() {} } });
    h.setHole(origin(), camAt(2), near);
    const u = h.pass.uniforms as unknown as { holeRadius: { value: number } };
    assert.equal(u.holeRadius.value, BLOOM_GUARD_RADIUS_MAX, "hole keeps its #57 clamp");
    h.dispose();
  });
});
