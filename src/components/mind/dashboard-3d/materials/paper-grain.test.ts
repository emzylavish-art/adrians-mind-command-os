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
import { makeParchmentRGBA } from "./lore-plaque.ts";
import {
  disposePainterlyKit,
  painterlyKitResourceCounts,
  type PainterlyKit,
} from "./use-painterly-kit.ts";
import {
  GLSL_HASH_NOISE,
  GLSL_MEDIUMP_GUARD,
  PAINTER_SHADER_VERSION,
  PainterlyPassShader,
  WatercolorStarShader,
  BrushBuildingShader,
  LorePlaqueShader,
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
  });
});

describe("hacker pass: paper grain size / NaN / OOM", () => {
  it("sanitizePaperGrainSize rejects NaN/Infinity/negatives and caps max", () => {
    assert.equal(sanitizePaperGrainSize(NaN), 256);
    assert.equal(sanitizePaperGrainSize(Infinity), 256);
    assert.equal(sanitizePaperGrainSize(-20), PAPER_GRAIN_MIN_SIZE);
    assert.equal(sanitizePaperGrainSize(1e9), PAPER_GRAIN_MAX_SIZE);
  });

  it("makePaperGrainRGBA never returns empty or oversized buffers on hostile sizes", () => {
    for (const size of [NaN, Infinity, -1, 0, 1e7]) {
      const buf = makePaperGrainRGBA(size as number);
      const edge = Math.sqrt(buf.length / 4);
      assert.ok(edge >= PAPER_GRAIN_MIN_SIZE && edge <= PAPER_GRAIN_MAX_SIZE);
      assert.equal(buf.length, edge * edge * 4);
    }
  });

  it("sanitizeFinite clamps NaN progress/floors", () => {
    assert.equal(sanitizeFinite(NaN, 0, 0, 1), 0);
    assert.equal(sanitizeFinite(999, 8, 1, 128), 128);
  });
});

describe("hacker pass: kit sky leak + idempotent dispose", () => {
  it("disposePainterlyKit disposes trackedSkies maps and is idempotent", () => {
    let skyMapDisposed = 0;
    let skyMatDisposed = 0;
    let texDisposed = 0;
    let shaderDisposed = 0;
    const skyMap = { dispose: () => { skyMapDisposed++; } };
    const sky = {
      map: skyMap,
      dispose: () => { skyMatDisposed++; },
    };
    const kit = {
      painterlyPass: { uniforms: {} },
      starSpriteTexture: { dispose: () => { texDisposed++; } },
      paperGrainTexture: { dispose: () => { texDisposed++; } },
      tracked: [{ name: "LorePlaqueMaterial", dispose: () => { shaderDisposed++; } }],
      trackedSkies: [sky],
      disposed: false,
      contextLost: false,
      createStarMaterial: () => null,
      createBuildingMaterial: () => null,
      createLorePlaqueMaterial: () => null,
      createSkyMaterial: () => null,
    } as unknown as PainterlyKit;

    assert.deepEqual(painterlyKitResourceCounts(kit), { materials: 1, skies: 1, disposed: false });
    disposePainterlyKit(kit);
    assert.equal(skyMapDisposed, 1);
    assert.equal(skyMatDisposed, 1);
    assert.equal(texDisposed, 2);
    assert.equal(shaderDisposed, 1);
    assert.deepEqual(painterlyKitResourceCounts(kit), { materials: 0, skies: 0, disposed: true });
    // second dispose must no-op (no double-free)
    disposePainterlyKit(kit);
    assert.equal(skyMapDisposed, 1);
    assert.equal(texDisposed, 2);
  });
});

describe("painter shader modules + lore plaque", () => {
  it("exports version and mediump guard", () => {
    assert.match(PAINTER_SHADER_VERSION, /^painter-/);
    assert.match(GLSL_HASH_NOISE, /paintFbm/);
    assert.match(GLSL_HASH_NOISE, new RegExp(GLSL_MEDIUMP_GUARD));
    assert.match(GLSL_HASH_NOISE, /paintWrap/);
  });

  it("painterly pass + star + building + lore uniforms", () => {
    assert.ok(PainterlyPassShader.uniforms.amount);
    assert.ok(WatercolorStarShader.uniforms.uStroke);
    assert.ok(BrushBuildingShader.uniforms.uFloors);
    assert.match(BrushBuildingShader.fragmentShader, /clamp\(max\(uFloors/);
    assert.ok(LorePlaqueShader.uniforms.uPaper);
    assert.ok(LorePlaqueShader.uniforms.uWash);
    assert.match(LorePlaqueShader.fragmentShader, /parchment/);
    assert.match(LorePlaqueShader.fragmentShader, /ink frame/);
  });

  it("parchment RGBA is opaque and sized safely", () => {
    const buf = makeParchmentRGBA(NaN as unknown as number);
    const edge = Math.sqrt(buf.length / 4);
    assert.ok(edge >= PAPER_GRAIN_MIN_SIZE);
    assert.equal(buf[3], 255);
    // warmer than pure grey noise — R channel average should exceed B
    let r = 0, b = 0, n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      r += buf[i]!;
      b += buf[i + 2]!;
      n++;
    }
    assert.ok(r / n > b / n);
  });
});
