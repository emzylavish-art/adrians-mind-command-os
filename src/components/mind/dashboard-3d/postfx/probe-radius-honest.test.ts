import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { METER_EDGE, type RegionReader } from "./backdrop-meter.ts";
import { createDetailBackdropDimPass, type UvRect } from "./detail-backdrop-dim.ts";
import { BLOOM_GUARD_RADIUS_MIN } from "./focus-bloom-guard.ts";

/**
 * Hacker pass (cycle after #84): the #84 card probe sized its rect from the
 * HOLE radius, which clampGuardRadius() replaces with a 0.16 default when
 * projectedRadiusUv() returns null (non-perspective / behind camera / junk),
 * and clamps to ≥0.04 when the card is tiny. The probe then metered a GUESSED
 * region and reported it as `contrast.card` — a fabricated "card" reading
 * that drives the key lift. The probe must use the real projected radius only.
 */
const fakeRenderer = { setRenderTarget() {}, clear() {}, render() {}, getRenderTarget: () => null } as never;
const readBuffer = { texture: new THREE.Texture(), width: 1600, height: 900 } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));
const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
function recReader() {
  const calls: UvRect[][] = [];
  const reader: RegionReader = {
    async read(_r, _s, rects) {
      calls.push(rects.map((r) => [...r] as UvRect));
      return rects.map(() => new Uint8Array(METER_EDGE * METER_EDGE * 4).fill(10));
    },
    dispose() {},
  };
  return { reader, calls };
}

describe("hacker: card probe never meters a guessed radius", () => {
  for (const rad of [null, undefined, NaN, 0, -0.2]) {
    it(`radius ${String(rad)} → no probe read, contrast.card null`, async () => {
      let t = 0;
      const { reader, calls } = recReader();
      const h = createDetailBackdropDimPass({ reader, now: () => t });
      h.setCardProbe(true);
      h.setHole(new THREE.Vector3(0, 0, 0), cam(), rad as number | null | undefined);
      h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
      await flush();
      t = 16;
      h.tick(16);
      assert.equal(calls.length, 0, "no read of a default-sized rect");
      assert.equal(h.contrast.card, null);
      assert.equal(h.pass.enabled, false, "nothing to meter, nothing to dim → pass off");
      h.dispose();
    });
  }

  it("tiny card (radius below the guard clamp) is metered at its real size", async () => {
    let t = 0;
    const { reader, calls } = recReader();
    const h = createDetailBackdropDimPass({ reader, now: () => t });
    h.setCardProbe(true);
    const r = BLOOM_GUARD_RADIUS_MIN / 4; // 0.01
    h.setHole(new THREE.Vector3(0, 0, 0), cam(), r);
    h.pass.render(fakeRenderer, {} as never, readBuffer, 0, false);
    await flush();
    t = 16;
    h.tick(16);
    assert.equal(calls.length, 1);
    const p = calls[0]![0]!;
    assert.ok(Math.abs(p[3] - p[1] - 2 * r) < 1e-6, `probe height ${p[3] - p[1]} should be 2r=${2 * r}`);
    assert.ok(h.contrast.card, "real reading");
    h.dispose();
  });
});
