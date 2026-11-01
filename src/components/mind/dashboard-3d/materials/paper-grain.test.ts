import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePaperGrainRGBA, paperHash } from "./paper-grain.ts";
import { GLSL_HASH_NOISE, PAINTER_SHADER_VERSION, PainterlyPassShader, WatercolorStarShader, BrushBuildingShader } from "../shaders/index.ts";

describe("painter paper grain", () => {
  it("hash is deterministic in 0..1", () => {
    assert.equal(paperHash(12, 3), paperHash(12, 3));
    assert.ok(paperHash(12, 3) >= 0 && paperHash(12, 3) < 1);
  });

  it("RGBA buffer has expected length and opaque alpha", () => {
    const buf = makePaperGrainRGBA(32, 5, 12);
    assert.equal(buf.length, 32 * 32 * 4);
    assert.equal(buf[3], 255);
    // not a flat fill
    let distinct = 0;
    const seen = new Set<number>();
    for (let i = 0; i < buf.length; i += 4) {
      seen.add(buf[i]!);
      if (seen.size > 4) {
        distinct = seen.size;
        break;
      }
    }
    assert.ok(distinct > 4);
  });
});

describe("painter shader modules", () => {
  it("exports version and shared noise", () => {
    assert.match(PAINTER_SHADER_VERSION, /^painter-/);
    assert.match(GLSL_HASH_NOISE, /paintFbm/);
  });

  it("painterly pass has wash + grain uniforms and fragment terms", () => {
    assert.ok(PainterlyPassShader.uniforms.amount);
    assert.ok(PainterlyPassShader.uniforms.grain);
    assert.ok(PainterlyPassShader.uniforms.wash);
    assert.match(PainterlyPassShader.fragmentShader, /paper grain/);
    assert.match(PainterlyPassShader.fragmentShader, /paintFbm/);
  });

  it("star + building shaders expose required uniforms", () => {
    assert.ok(WatercolorStarShader.uniforms.uColor);
    assert.ok(WatercolorStarShader.uniforms.uStroke);
    assert.match(WatercolorStarShader.fragmentShader, /brush stroke/);
    assert.ok(BrushBuildingShader.uniforms.uFloors);
    assert.ok(BrushBuildingShader.uniforms.uProgress);
    assert.match(BrushBuildingShader.fragmentShader, /vertical brush/);
  });
});
