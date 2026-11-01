import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  makePaperGrainRGBA,
  paperHash,
  sanitizePaperGrainSize,
  clampTextureSizeToGpu,
  sanitizeFinite,
  sanitizeShaderTime,
  PAINTER_TIME_PERIOD,
  PAPER_GRAIN_MAX_SIZE,
  PAPER_GRAIN_MIN_SIZE,
  GPU_SAFE_TEXTURE_DEFAULT,
} from "./paper-grain.ts";
import {
  makeParchmentRGBA,
  sanitizeLoreNotes,
  LORE_MAX_NOTES,
  LORE_MAX_CHARS_PER_NOTE,
} from "./lore-plaque.ts";
import {
  disposePainterlyKit,
  painterlyKitResourceCounts,
  tickPainterlyKit,
  releasePainterlyMaterial,
  type PainterlyKit,
} from "./use-painterly-kit.ts";
import {
  createInkWashEdgeMaterial,
  setInkWashEdgeHealth,
  buildInkWashRibbon,
  sanitizeHealthToneArray,
  HEALTH_RGB,
} from "./ink-wash-edge.ts";
import { createStarWatercolorMaterial, tickStarMaterial } from "./star-surface.ts";
import {
  GLSL_HASH_NOISE,
  GLSL_MEDIUMP_GUARD,
  PAINTER_SHADER_VERSION,
  PainterlyPassShader,
  WatercolorStarShader,
  BrushBuildingShader,
  LorePlaqueShader,
  InkWashEdgeShader,
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
      createInkWashEdgeMaterial: () => null,
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

describe("hacker pass c3: MAX_TEXTURE_SIZE + lore notes + health array bounds", () => {
  it("clampTextureSizeToGpu never exceeds device MAX_TEXTURE_SIZE or soft default", () => {
    assert.equal(clampTextureSizeToGpu(2048, 512), 512);
    assert.equal(clampTextureSizeToGpu(2048, undefined), Math.min(2048, GPU_SAFE_TEXTURE_DEFAULT));
    assert.equal(clampTextureSizeToGpu(64, 4096), 64);
    assert.equal(clampTextureSizeToGpu(NaN, 128), 128); // fallback sanitized then min with gpu
    // hostile gpu max
    assert.equal(clampTextureSizeToGpu(2048, 4), Math.min(2048, GPU_SAFE_TEXTURE_DEFAULT)); // invalid gpu max → default
    assert.equal(clampTextureSizeToGpu(99999, 1024), 1024);
  });

  it("sanitizeLoreNotes caps huge/odd note dumps and marks truncation", () => {
    const huge = Array.from({ length: 500 }, (_, i) => "note-" + i + "-".repeat(400));
    const res = sanitizeLoreNotes(huge);
    assert.ok(res.notes.length <= LORE_MAX_NOTES);
    assert.ok(res.truncatedCount > 0);
    assert.equal(res.inputCount, 500);
    for (const n of res.notes) {
      assert.ok(n.text.length <= LORE_MAX_CHARS_PER_NOTE);
    }
    const weird = sanitizeLoreNotes([null, 12, "\u0000bad\n  text  ", "ok"]);
    assert.ok(weird.notes.every((n) => !/[\u0000-\u0008]/.test(n.text)));
    assert.ok(weird.notes.some((n) => n.text.includes("ok") || n.text.includes("bad")));
  });

  it("sanitizeHealthToneArray fills OOB/odd entries as idle with badCount", () => {
    const r = sanitizeHealthToneArray(["healthy", "nope", 3, "blocked"], 5);
    assert.equal(r.length, 5);
    assert.equal(r.tones[0], "healthy");
    assert.equal(r.tones[1], "idle");
    assert.equal(r.tones[3], "blocked");
    assert.equal(r.tones[4], "idle");
    assert.ok(r.badCount >= 3);
    assert.ok(HEALTH_RGB.healthy[1] > 0.5);
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
    assert.ok(InkWashEdgeShader.uniforms.uHealth);
    assert.ok(InkWashEdgeShader.uniforms.uInk);
    assert.match(InkWashEdgeShader.fragmentShader, /paintFbm/);
    // weak-GPU: no derivatives extension needed, no dynamic loops
    assert.doesNotMatch(InkWashEdgeShader.fragmentShader, /dFdx|dFdy|fwidth/);
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

describe("hacker pass c3: unbounded / NaN shader time (mediump overflow)", () => {
  it("sanitizeShaderTime wraps long sessions into a mediump-safe period", () => {
    // fp16 mediump max is 65504; a wall dashboard left open ~18h exceeds it -> Inf -> NaN sin
    for (const t of [0, 12.5, 65504, 86400 * 3, 1e12, -50]) {
      const w = sanitizeShaderTime(t);
      assert.ok(Number.isFinite(w), "finite for " + t);
      assert.ok(w >= 0 && w < PAINTER_TIME_PERIOD, "in period for " + t + " got " + w);
    }
    assert.equal(sanitizeShaderTime(12.5), 12.5);
    assert.equal(sanitizeShaderTime(NaN), 0);
    assert.equal(sanitizeShaderTime(Infinity), 0);
    assert.ok(PAINTER_TIME_PERIOD <= 2048);
  });

  it("tickStarMaterial never writes NaN/Infinity/huge uTime", () => {
    const m = createStarWatercolorMaterial();
    for (const t of [NaN, Infinity, -Infinity, 86400 * 2]) {
      tickStarMaterial(m, t);
      const v = m.uniforms["uTime"]!.value as number;
      assert.ok(Number.isFinite(v) && v >= 0 && v < PAINTER_TIME_PERIOD, "star uTime " + t + " -> " + v);
    }
    m.dispose();
  });

  it("tickPainterlyKit wraps time for every tracked material incl. ink-wash edges + fallback", () => {
    const edge = createInkWashEdgeMaterial({ health: "stalled" });
    const custom = { name: "Custom", uniforms: { uTime: { value: 0 } }, dispose() {} };
    const pass = { uniforms: { time: { value: 0 } } };
    const kit = {
      painterlyPass: pass,
      tracked: [edge, custom],
      trackedSkies: [],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;
    tickPainterlyKit(kit, 86400 * 2);
    for (const v of [edge.uniforms["uTime"]!.value, custom.uniforms.uTime.value, pass.uniforms.time.value]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v < PAINTER_TIME_PERIOD, "kit time -> " + v);
    }
    tickPainterlyKit(kit, NaN);
    assert.equal(custom.uniforms.uTime.value, 0);
    edge.dispose();
  });
});

describe("hacker pass c3: ink-wash health prototype keys", () => {
  it("prototype-key tones (constructor/toString/__proto__) resolve to idle, never NaN", () => {
    for (const tone of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const m = createInkWashEdgeMaterial({ health: tone as never });
      const c = m.uniforms["uHealth"]!.value as { r: number; g: number; b: number };
      assert.ok(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b), tone);
      assert.equal(c.r, HEALTH_RGB.idle[0]);
      setInkWashEdgeHealth(m, tone as never);
      assert.ok(Number.isFinite((m.uniforms["uHealth"]!.value as { r: number }).r));
      m.dispose();
    }
  });

  it("NaN numeric colour falls back to idle instead of NaN uniform", () => {
    const m = createInkWashEdgeMaterial({ health: NaN });
    const c = m.uniforms["uHealth"]!.value as { r: number };
    assert.ok(Number.isFinite(c.r));
    m.dispose();
  });
});

describe("ink-wash ribbon geometry", () => {
  it("builds a ribbon with uv.x along edge and uv.y across, finite positions", () => {
    const g = buildInkWashRibbon([0, 0, 0], [10, 0, 0], { width: 0.4, segments: 8 });
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    assert.equal(pos.count, (8 + 1) * 2);
    assert.equal(uv.getX(0), 0);
    assert.equal(uv.getX(pos.count - 1), 1);
    for (let i = 0; i < pos.count * 3; i++) assert.ok(Number.isFinite((pos.array as Float32Array)[i]!));
    const side = g.getAttribute("aSide");
    const tan = g.getAttribute("aTangent");
    assert.equal(side.count, pos.count);
    assert.ok(side.getX(0) < 0 && side.getX(1) > 0, "signed half-width across the ribbon");
    assert.ok(Math.abs(side.getX(9) - 0.2) < 1e-6, "mid-span is full width (taper=1)");
    for (let i = 0; i < tan.count; i++) {
      const l = Math.hypot(tan.getX(i), tan.getY(i), tan.getZ(i));
      assert.ok(Math.abs(l - 1) < 1e-4, "unit tangent");
    }
    g.dispose();
  });

  it("vertex shader is camera-facing and guards normalize(0)", () => {
    assert.match(InkWashEdgeShader.vertexShader, /attribute vec3 aTangent/);
    assert.match(InkWashEdgeShader.vertexShader, /attribute float aSide/);
    assert.match(InkWashEdgeShader.vertexShader, /inversesqrt\(len2\)/);
    assert.doesNotMatch(InkWashEdgeShader.vertexShader, /normalize\(/);
  });

  it("hostile inputs (NaN endpoints, zero-length, huge segments) stay finite and bounded", () => {
    const g = buildInkWashRibbon([NaN, 0, 0], [NaN, Infinity, 0], { width: NaN, segments: 1e9 });
    const pos = g.getAttribute("position");
    assert.ok(pos.count <= (256 + 1) * 2);
    for (let i = 0; i < pos.count * 3; i++) assert.ok(Number.isFinite((pos.array as Float32Array)[i]!));
    const ht = g.getAttribute("aTangent");
    for (let i = 0; i < ht.count * 3; i++) assert.ok(Number.isFinite((ht.array as Float32Array)[i]!));
    g.dispose();
    const z = buildInkWashRibbon([1, 2, 3], [1, 2, 3]);
    for (let i = 0; i < z.getAttribute("position").count * 3; i++) {
      assert.ok(Number.isFinite((z.getAttribute("position").array as Float32Array)[i]!));
    }
    z.dispose();
  });
});

describe("hacker pass c3: rebuilt edge materials must not accumulate in kit", () => {
  it("releasePainterlyMaterial untracks + disposes; repeated rebuilds stay bounded", () => {
    // node has no canvas, so mock the kit shell but use the real material + release path
    const tracked: ReturnType<typeof createInkWashEdgeMaterial>[] = [];
    const kit = {
      painterlyPass: { uniforms: {} },
      starSpriteTexture: { dispose() {} },
      paperGrainTexture: { dispose() {} },
      tracked,
      trackedSkies: [],
      disposed: false,
      contextLost: false,
      createInkWashEdgeMaterial: (o?: object) => {
        const m = createInkWashEdgeMaterial(o);
        tracked.push(m);
        return m;
      },
    } as unknown as PainterlyKit;
    for (let poll = 0; poll < 50; poll++) {
      const mats = [0, 1, 2].map(() => kit.createInkWashEdgeMaterial({ health: "healthy" }));
      for (const m of mats) assert.equal(releasePainterlyMaterial(kit, m), true);
    }
    assert.equal(painterlyKitResourceCounts(kit).materials, 0);
    const stray = createInkWashEdgeMaterial();
    assert.equal(releasePainterlyMaterial(kit, stray), false);
    stray.dispose();
    disposePainterlyKit(kit);
  });
});
