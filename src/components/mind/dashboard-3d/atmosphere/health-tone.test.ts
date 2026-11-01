import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AMBIENT_RGB,
  FOG_PARAMS,
  HEALTH_HEX,
  deriveFleetTone,
  isHealthTone,
} from "./health-tone.ts";

describe("health-tone", () => {
  it("maps each tone to a distinct hex", () => {
    const hexes = Object.values(HEALTH_HEX);
    assert.equal(new Set(hexes).size, 4);
    assert.equal(HEALTH_HEX.healthy, 0x3dd68c);
    assert.equal(HEALTH_HEX.stalled, 0xfbbf24);
    assert.equal(HEALTH_HEX.blocked, 0xff6b8a);
  });

  it("deriveFleetTone prioritizes blocked > stalled > healthy > idle", () => {
    assert.equal(deriveFleetTone([]), "idle");
    assert.equal(deriveFleetTone(["idle", "healthy"]), "healthy");
    assert.equal(deriveFleetTone(["healthy", "stalled"]), "stalled");
    assert.equal(deriveFleetTone(["stalled", "blocked", "healthy"]), "blocked");
  });

  it("fog density rises as tone worsens", () => {
    assert.ok(FOG_PARAMS.idle.density < FOG_PARAMS.stalled.density);
    assert.ok(FOG_PARAMS.stalled.density < FOG_PARAMS.blocked.density);
    assert.ok(FOG_PARAMS.healthy.density <= FOG_PARAMS.idle.density);
  });

  it("ambient RGB channels stay in 0–1", () => {
    for (const rgb of Object.values(AMBIENT_RGB)) {
      for (const c of rgb) {
        assert.ok(c >= 0 && c <= 1);
      }
    }
  });

  it("isHealthTone guards unknown strings", () => {
    assert.equal(isHealthTone("healthy"), true);
    assert.equal(isHealthTone("nope"), false);
  });
});
