import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  makePaperGrainRGBA,
  paperHash,
  sanitizePaperGrainSize,
  sanitizeFinite,
  PAPER_GRAIN_MAX_SIZE,
  PAPER_GRAIN_MIN_SIZE,
} from "./paper-grain.ts";
import {
  GLSL_HASH_NOISE,
  PAINTER_SHADER_VERSION,
  PainterlyPassShader,
  WatercolorStarShader,
  BrushBuildingShader,
} from "../shaders/index.ts";

describe("painter paper grain", () => {
  it("hash is deterministic in 0..1", () => {
    assert.equal(paperHash(12, 3), paperHash(12, 3));
    assert.ok(paperHash(12, 3) >= 0 && paperHash(12, 3) < 1);
  });

  it("RGBA buffer has expected length and opaque alpha", () => {
    const buf = makePaperGrainRGBA(32, 5, 12);
    assert.equal(buf.length, 32 * 32 * 4);
    assert.equal(buf[3], 255);
    const seen = new Set<number>();
    for (let i = 0; i < buf.length; i += 4) {
      seen.add(buf[i]!);
      if (seen.size > 4) break;
    }
    assert.ok(seen.size > 4);
  });
});

describe("hacker pass: paper grain size / NaN / OOM", () => {
  it("sanitizePaperGrainSize rejects NaN/Infinity/negatives and caps max", () => {
    assert.equal(sanitizePaperGrainSize(NaN), 256);
    assert.equal(sanitizePaperGrainSize(Infinity), 256);
    assert.equal(sanitizePaperGrainSize(-20), PAPER_GRAIN_MIN_SIZE);
    assert.equal(sanitizePaperGrainSize(0), PAPER_GRAIN_MIN_SIZE);
    assert.equal(sanitizePaperGrainSize(1e9), PAPER_GRAIN_MAX_SIZE);
    assert.equal(sanitizePaperGrainSize(128), 128);
  });

  it("makePaperGrainRGBA never returns empty or oversized buffers on hostile sizes", () => {
    for (const size of [NaN, Infinity, -1, 0, 3, 1e7, Number.MAX_SAFE_INTEGER]) {
      const buf = makePaperGrainRGBA(size as number);
      const edge = Math.sqrt(buf.length / 4);
      assert.ok(Number.isFinite(edge));
      assert.ok(edge >= PAPER_GRAIN_MIN_SIZE && edge <= PAPER_GRAIN_MAX_SIZE);
      assert.equal(buf.length, edge * edge * 4);
      assert.equal(buf[3], 255);
    }
  });

  it("sanitizeFinite clamps NaN progress/floors (building uniforms)", () => {
    assert.equal(sanitizeFinite(NaN, 0, 0, 1), 0);
    assert.equal(sanitizeFinite(Infinity, 8, 1, 128), 8);
    assert.equal(sanitizeFinite(999, 8, 1, 128), 128);
    assert.equal(sanitizeFinite(-4, 8, 1, 128), 1);
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

  it("star + building shaders expose required uniforms; floors clamped in GLSL", () => {
    assert.ok(WatercolorStarShader.uniforms.uColor);
    assert.ok(WatercolorStarShader.uniforms.uStroke);
    assert.match(WatercolorStarShader.fragmentShader, /brush stroke/);
    assert.ok(BrushBuildingShader.uniforms.uFloors);
    assert.ok(BrushBuildingShader.uniforms.uProgress);
    assert.match(BrushBuildingShader.fragmentShader, /vertical brush/);
    assert.match(BrushBuildingShader.fragmentShader, /clamp\(max\(uFloors/);
  });
});
