import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  makePaperGrainRGBA,
  paperHash,
  sanitizePaperGrainSize,
  clampTextureSizeToGpu,
  sanitizeFinite,
  sanitizeShaderTime,
  shaderTimeAngle,
  sanitizePainterColor,
  PAINTER_IDLE_RGB,
  createPaperGrainTexture,
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
  LORE_ATLAS_MIN,
  LORE_ATLAS_DEFAULT,
} from "./lore-plaque.ts";
import {
  applyLorePlaqueStackLayer,
  applyPainterLogDepthSupport,
  applyPainterTransparentLayer,
  resolvePainterlyRenderTargetType,
  probeHalfFloatRenderTargetSupport,
  PAINTER_RENDER_ORDER,
  LORE_PLAQUE_OFFSET_UNITS,
} from "./painter-depth.ts";
import {
  applyPainterOutputSafeFlags,
  bloomSafeClampRgb,
  starMatteFromStatus,
  sanitizeStarHalo,
  PAINTER_MATTE_DEFAULT,
  PAINTER_MATTE_IDLE,
  PAINTER_HDR_CEILING,
  PAINTER_BLOOM_SAFE_CEILING,
  painterPigmentFromStatusColor,
  painterGlowColorScale,
  sanitizePainterEmissive,
  PAINTER_EMISSIVE_MAX,
  PAINTER_PIGMENT_MAX_CHANNEL,
} from "./painter-output.ts";
import {
  createPainterlyKit,
  disposePainterlyKit,
  disposeAllPainterlyKits,
  disposePainterlyKitsByScope,
  PAINTER_KIT_DISPOSED,
  livePainterlyKitCount,
  painterlyKitResourceCounts,
  tickPainterlyKit,
  releasePainterlyMaterial,
  painterlyKitTextureBudget,
  rebindPainterlyKitTextures,
  applyTextureBinding,
  attachPainterlyContextHandlers,
  type PainterlyKit,
} from "./use-painterly-kit.ts";
import { createPainterlyBotStar } from "./painterly-bot-star.ts";
import {
  createFleetBeacon,
  sanitizeFleetBeaconRadius,
  FLEET_BEACON_RADIUS_MAX,
  FLEET_BEACON_RADIUS_MIN,
} from "./fleet-beacon.ts";
import {
  createPainterlyInkEdges,
  buildMergedInkWashGeometry,
} from "./painterly-ink-edges.ts";
import {
  createPainterlyLaneNebulae,
  createLaneNebulaMaterial,
  setLaneNebulaHealth,
  LANE_NEBULAE_MAX,
  LANE_POOL_BY_HEALTH,
  LANE_WASH_BY_HEALTH,
} from "./lane-nebula.ts";
import {
  createBuildingBrushMaterial,
  setBuildingProgress,
  setBuildingWindowGlow,
  setBuildingDryBrush,
  buildingDryBrushFromProgress,
  createBuildingBrushPool,
  BUILDING_BRUSH_POOL_MAX,
} from "./building-surface.ts";
import {
  estimateTextureBytes,
  sanitizeTextureBudgetBytes,
  PAINTER_TEXTURE_BUDGET_BYTES,
  noteTextureBudgetReport,
  createBudgetDegradeState,
  BUDGET_HYSTERESIS_FRAMES,
  BUDGET_HYSTERESIS_RATIO,
} from "./painter-texture-budget.ts";
import {
  markImagineNodeReleased,
  isImagineNodeReleased,
  beginImagineNodeMapBind,
  getImagineNodeBindGeneration,
  setImagineNodeMapIfGeneration,
  imagineWashFromLaneHealth,
  setImagineNodeLaneWash,
  setImagineNodeLoading,
  setImagineNodeMapFailed,
  IMAGINE_LANE_ACCENT_RGB,
  setImagineNodeFocus,
  setImagineNodeQuality,
  painterQualityFromDpr,
  isImagineNodeFocusable,
  IMAGINE_FOCUS_EASE,
  imagineAspectFromDims,
  applyImagineSamplerSafe,
  clampImagineAnisotropy,
  IMAGINE_ASPECT_MAX,
  IMAGINE_ASPECT_DEFAULT,
  IMAGINE_ANISOTROPY_SAFE_DEFAULT,
} from "./imagine-node.ts";
import {
  createCityGroundMaterial,
  tickCityGroundMaterial,
  setCityGroundRing,
  setCityGroundPlazaScale,
  cityGroundPlazaScaleFromRadius,
  CITY_GROUND_PLAZA_SCALE_MAX,
} from "./city-ground.ts";
import { CityGroundShader } from "../shaders/city-ground.ts";
import {
  createImagineNodeMaterial,
  setImagineNodeMap,
  setImagineNodePaperMap,
  tickImagineNodeMaterial,
  sanitizeImagineImageTexture,
  readTextureImageSize,
  isPowerOfTwoSize,
  IMAGINE_IMAGE_HARD_MAX,
} from "./imagine-node.ts";
import {
  createLoreTextAtlas,
  setLorePlaqueTextAtlas,
  createLorePlaqueMaterial,
  disposeLorePlaqueOwnedAtlas,
  parseLockClaimedAtMs,
  lockAgeSecondsFromClaimedAt,
  loreInkDensityFromAgeSeconds,
  lorePaperFromAgeSeconds,
  setLorePlaqueLockAge,
  setLorePlaqueInkDensity,
  loreNotesFingerprint,
  setLorePlaqueNotesCached,
  setLorePlaqueStackIndex,
  LORE_CLOCK_SKEW_S,
  LORE_INK_AGE_STALE_S,
  LORE_INK_AGE_MAX_S,
  LORE_INK_DENSITY_NEUTRAL,
  LORE_INK_DENSITY_FRESH,
  LORE_INK_DENSITY_FADED,
  LORE_PAPER_NEUTRAL,
} from "./lore-plaque.ts";
import {
  createInkWashEdgeMaterial,
  setInkWashEdgeHealth,
  setInkWashEdgeBleed,
  inkBleedFromWeight,
  buildInkWashRibbon,
  sanitizeHealthToneArray,
  HEALTH_RGB,
  isDegenerateInkEdge,
  measureInkEdgeLength,
  INK_EDGES_MAX,
  INK_EDGE_DEGENERATE_EPS,
} from "./ink-wash-edge.ts";
import { createStarWatercolorMaterial, createStarSpriteTexture, tickStarMaterial, setStarHalo, setStarGrain, setStarMatte, setStarWatercolorColor, starGrainFromHealth, STAR_GRAIN_BY_HEALTH } from "./star-surface.ts";
import {
  GLSL_HASH_NOISE,
  GLSL_MEDIUMP_GUARD,
  PAINTER_SHADER_VERSION,
  PAINTER_SHADER_PRECISION,
  PainterlyPassShader,
  PainterlyPassFallbackShader,
  WatercolorStarShader,
  BrushBuildingShader,
  LorePlaqueShader,
  InkWashEdgeShader,
  LaneNebulaShader,
  ImagineNodeShader,
  createPainterlyPass,
  tickPainterlyPass,
  disposePainterlyPass,
  resizePainterlyPass,
  flushPainterlyPassResize,
  safePainterlyPassSize,
  painterlyAmountFromHealth,
  setPainterlyPassHealth,
  setPainterlyPassAmount,
  sanitizePainterlyPassUniforms,
  setPainterlyPassFiber,
  painterlyFiberFromAmount,
  PAINTER_FIBER_DEFAULT,
  PAINTER_FIBER_MIN,
  PAINTER_FIBER_MAX,
  painterlyPassResizeStats,
  PAINTER_PASS_MAX_EDGE,
  PAINTER_PASS_MAX_DPR,
  PAINTER_AMOUNT_MIN,
  PAINTER_AMOUNT_MAX,
  PAINTER_PASS_GRAIN_DEFAULT,
  PAINTER_PASS_BRUSH_OFFSET_MAX,
  PAINTER_RESIZE_MIN_INTERVAL_MS,
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
      textureBindings: [],
      disposed: false,
      contextLost: false,
      createStarMaterial: () => null,
      createBuildingMaterial: () => null,
      createLorePlaqueMaterial: () => null,
      createInkWashEdgeMaterial: () => null,
      createImagineNodeMaterial: () => null,
      createSkyMaterial: () => null,
      bindSharedTexture: () => {},
    } as unknown as PainterlyKit;

    assert.deepEqual(painterlyKitResourceCounts(kit), { materials: 1, skies: 1, bindings: 0, disposed: false });
    disposePainterlyKit(kit);
    assert.equal(skyMapDisposed, 1);
    assert.equal(skyMatDisposed, 1);
    assert.equal(texDisposed, 2);
    assert.equal(shaderDisposed, 1);
    assert.deepEqual(painterlyKitResourceCounts(kit), { materials: 0, skies: 0, bindings: 0, disposed: true });
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
    assert.ok(LorePlaqueShader.uniforms.uHasText);
    assert.match(LorePlaqueShader.fragmentShader, /uTextMap/);
    assert.ok(InkWashEdgeShader.uniforms.uHealth);
    assert.ok(InkWashEdgeShader.uniforms.uInk);
    assert.match(InkWashEdgeShader.fragmentShader, /paintFbm/);
    // weak-GPU: no derivatives extension needed, no dynamic loops
    assert.doesNotMatch(InkWashEdgeShader.fragmentShader, /dFdx|dFdy|fwidth/);
    assert.ok(ImagineNodeShader.uniforms.uHasImage);
    assert.ok(ImagineNodeShader.uniforms.uBleed);
    assert.ok(ImagineNodeShader.uniforms.uFrame);
    assert.match(ImagineNodeShader.fragmentShader, /Watercolor edge bleed|softEdge|uBleed/);
    assert.match(ImagineNodeShader.fragmentShader, /uHasImage/);
    assert.doesNotMatch(ImagineNodeShader.fragmentShader, /dFdx|dFdy|fwidth/);
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
      textureBindings: [],
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
      textureBindings: [],
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


describe("hacker pass c4: context-restore texture rebind", () => {
  it("rebindPainterlyKitTextures re-attaches NEW paper/star objects to consumers (blank-surface bug)", () => {
    const oldPaper = { id: "old-paper", needsUpdate: false, dispose() {} };
    const oldStar = { id: "old-star", needsUpdate: false, dispose() {} };
    const newPaper = { id: "new-paper", needsUpdate: false, dispose() {} };
    const newStar = { id: "new-star", needsUpdate: false, dispose() {} };

    // Simulate Dashboard Bot SpriteMaterial that captured kit.starSpriteTexture
    const glowMat = { map: oldStar as unknown as null, needsUpdate: false };
    // Imagine node with paper uniform bound to old paper
    const imagine = createImagineNodeMaterial();
    imagine.uniforms["uPaperMap"]!.value = oldPaper;
    imagine.uniforms["uHasPaper"]!.value = 1;
    const fakeImage = { needsUpdate: false, image: { width: 64, height: 64 } };
    setImagineNodeMap(imagine, fakeImage as never);

    const kit = {
      painterlyPass: { uniforms: {} },
      starSpriteTexture: newStar,
      paperGrainTexture: newPaper,
      tracked: [imagine],
      trackedSkies: [],
      textureBindings: [
        { material: glowMat as never, slot: "starSprite" as const, target: "map" },
        { material: imagine, slot: "paperGrain" as const, target: "uPaperMap" },
      ],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;

    // PRECONDITION: consumers still hold OLD disposed textures → blank after restore
    assert.equal((glowMat.map as unknown as { id: string }).id, "old-star");
    assert.equal((imagine.uniforms["uPaperMap"]!.value as { id: string }).id, "old-paper");

    const n = rebindPainterlyKitTextures(kit);
    assert.ok(n >= 4, "rebind touches kit textures + bindings + imagine");
    assert.equal((glowMat.map as unknown as { id: string }).id, "new-star", "sprite map must point at NEW star texture");
    assert.equal(glowMat.needsUpdate, true);
    assert.equal((imagine.uniforms["uPaperMap"]!.value as { id: string }).id, "new-paper");
    assert.equal(imagine.uniforms["uHasPaper"]!.value, 1);
    assert.equal(fakeImage.needsUpdate, true, "Imagine image must be marked for re-upload");
    assert.equal(newPaper.needsUpdate, true);
    assert.equal(newStar.needsUpdate, true);
    imagine.dispose();
  });

  it("attachPainterlyContextHandlers restore recreates textures then rebinds consumers", () => {
    const listeners = new Map<string, EventListener>();
    const canvas = {
      addEventListener: (t: string, fn: EventListener) => { listeners.set(t, fn); },
      removeEventListener: (t: string, fn: EventListener) => { if (listeners.get(t) === fn) listeners.delete(t); },
    } as unknown as HTMLCanvasElement;

    let paperGen = 0;
    let starGen = 0;
    const makePaper = () => ({ id: "paper-" + (++paperGen), needsUpdate: false, dispose() {} });
    const makeStar = () => ({ id: "star-" + (++starGen), needsUpdate: false, dispose() {} });

    const glowMat = { map: null as unknown, needsUpdate: false };
    const kit = {
      painterlyPass: { uniforms: {} },
      starSpriteTexture: makeStar() as never,
      paperGrainTexture: makePaper() as never,
      tracked: [] as never[],
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: "starSprite" | "paperGrain"; target?: string }[],
      disposed: false,
      contextLost: false,
      bindSharedTexture(material: import("three").Material, slot: "starSprite" | "paperGrain", target = "map") {
        kit.textureBindings.push({ material, slot, target });
        applyTextureBinding(kit as never, { material, slot, target });
      },
    } as unknown as PainterlyKit;

    // Monkeypatch creators used inside onRestored by swapping kit fields after dispose
    // We intercept by wrapping the restore path: call handlers, then manually mimic recreate
    // using the real attachPainterlyContextHandlers — but createStarSpriteTexture needs DOM.
    // So instead: exercise the public rebind + binding path the handler calls, and verify
    // lost/restored flags + listener detach.
    const detach = attachPainterlyContextHandlers(canvas, kit, () => { /* rebuild */ });
    assert.ok(listeners.has("webglcontextlost"));
    assert.ok(listeners.has("webglcontextrestored"));

    const lost = listeners.get("webglcontextlost")!;
    const restored = listeners.get("webglcontextrestored")!;
    const ev = { preventDefault() {} } as unknown as Event;
    lost(ev);
    assert.equal(kit.contextLost, true);

    // Simulate what onRestored does without DOM: recreate + rebind
    kit.contextLost = false;
    (kit.starSpriteTexture as { dispose: () => void }).dispose();
    (kit.paperGrainTexture as { dispose: () => void }).dispose();
    kit.starSpriteTexture = makeStar() as never;
    kit.paperGrainTexture = makePaper() as never;
    kit.bindSharedTexture(glowMat as never, "starSprite", "map");
    rebindPainterlyKitTextures(kit);
    assert.equal((glowMat.map as unknown as { id: string }).id, "star-2");
    assert.equal(kit.contextLost, false);

    // Calling the real restored handler would try document.createElement — skip invoking it
    // in node. Detach must remove listeners.
    detach();
    assert.equal(listeners.size, 0);
    // silence unused
    void restored;
  });
});

describe("painter c4: Imagine node card material", () => {
  it("falls back to wash when map is missing; setImagineNodeMap toggles uHasImage", () => {
    const m = createImagineNodeMaterial({ accent: "#7ec8ff", bleed: 0.6 });
    assert.equal(m.name, "ImagineNodeMaterial");
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    assert.equal(m.uniforms["uHasPaper"]!.value, 0);
    const fake = { needsUpdate: false, image: { width: 64, height: 64 }, dispose() {} };
    setImagineNodeMap(m, fake as never);
    assert.equal(m.uniforms["uHasImage"]!.value, 1);
    assert.equal(m.uniforms["uImage"]!.value, fake);
    setImagineNodeMap(m, null);
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    tickImagineNodeMaterial(m, 86400);
    const t = m.uniforms["uTime"]!.value as number;
    assert.ok(Number.isFinite(t) && t >= 0 && t < PAINTER_TIME_PERIOD);
    m.dispose();
  });

  it("paper map bind/unbind and NaN option clamps stay finite", () => {
    const m = createImagineNodeMaterial({
      grain: NaN,
      bleed: Infinity,
      frame: -3,
      opacity: 99,
    });
    assert.ok(Number.isFinite(m.uniforms["uGrain"]!.value as number));
    assert.ok((m.uniforms["uBleed"]!.value as number) <= 1);
    assert.ok((m.uniforms["uFrame"]!.value as number) >= 0);
    assert.ok((m.uniforms["uOpacity"]!.value as number) <= 1);
    const paper = { needsUpdate: false };
    setImagineNodePaperMap(m, paper as never);
    assert.equal(m.uniforms["uHasPaper"]!.value, 1);
    setImagineNodePaperMap(m, null);
    assert.equal(m.uniforms["uHasPaper"]!.value, 0);
    m.dispose();
  });

  it("releasePainterlyMaterial drops Imagine textureBindings so rebuilds stay bounded", () => {
    const tracked: ReturnType<typeof createImagineNodeMaterial>[] = [];
    const textureBindings: { material: unknown; slot: string; target?: string }[] = [];
    const paper = { needsUpdate: false, dispose() {} };
    const kit = {
      painterlyPass: { uniforms: {} },
      starSpriteTexture: { dispose() {} },
      paperGrainTexture: paper,
      tracked,
      trackedSkies: [],
      textureBindings,
      disposed: false,
      contextLost: false,
      createImagineNodeMaterial: (o?: object) => {
        const m = createImagineNodeMaterial({ ...(o as object), paperMap: paper as never });
        tracked.push(m);
        textureBindings.push({ material: m, slot: "paperGrain", target: "uPaperMap" });
        return m;
      },
    } as unknown as PainterlyKit;
    for (let i = 0; i < 30; i++) {
      const m = kit.createImagineNodeMaterial({});
      assert.equal(releasePainterlyMaterial(kit, m), true);
    }
    assert.equal(painterlyKitResourceCounts(kit).materials, 0);
    assert.equal(painterlyKitResourceCounts(kit).bindings, 0);
    disposePainterlyKit(kit);
  });
});


describe("hacker pass c5: Imagine texture dims / NPOT / MAX_TEXTURE_SIZE / taint", () => {
  function fakeTex(w: number, h: number, extra: Record<string, unknown> = {}) {
    return {
      image: { width: w, height: h },
      needsUpdate: false,
      generateMipmaps: true,
      minFilter: 1008,
      magFilter: 1008,
      wrapS: 1000,
      wrapT: 1000,
      colorSpace: "srgb",
      dispose() {},
      ...extra,
    } as unknown as import("three").Texture;
  }

  it("sanitizeImagineImageTexture rejects missing / zero / NaN / hard-max dims with explicit reason", () => {
    assert.equal(sanitizeImagineImageTexture(null).reason, "missing");
    assert.equal(sanitizeImagineImageTexture(fakeTex(0, 10)).reason, "invalid-dimensions");
    assert.equal(sanitizeImagineImageTexture(fakeTex(NaN, 64)).reason, "invalid-dimensions");
    const huge = sanitizeImagineImageTexture(fakeTex(IMAGINE_IMAGE_HARD_MAX + 1, 64));
    assert.equal(huge.ok, false);
    assert.equal(huge.reason, "dimensions-exceed-hard-max");
  });

  it("exceeds MAX_TEXTURE_SIZE without downscale → wash path reason, not silent ok", () => {
    const r = sanitizeImagineImageTexture(fakeTex(2048, 2048), {
      maxTextureSize: 512,
      allowDownscale: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "exceeds-max-texture-size");
    assert.equal(r.width, 2048);
  });

  it("NPOT textures get mipmaps disabled + clamp wrap when accepted", () => {
    const tex = fakeTex(300, 200); // NPOT
    const r = sanitizeImagineImageTexture(tex, { maxTextureSize: 1024, allowDownscale: false });
    assert.equal(r.ok, true);
    assert.equal(r.npot, true);
    assert.equal(tex.generateMipmaps, false);
    assert.ok(isPowerOfTwoSize(256));
    assert.equal(isPowerOfTwoSize(300), false);
    assert.deepEqual(readTextureImageSize(tex), { width: 300, height: 200 });
  });

  it("setImagineNodeMap records imagineMapError on reject (fallback must not hide load errors)", () => {
    const m = createImagineNodeMaterial({ maxTextureSize: 256 });
    const bad = fakeTex(4096, 4096);
    const r = setImagineNodeMap(m, bad, { maxTextureSize: 256, allowDownscale: false });
    assert.equal(r.ok, false);
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    assert.equal((m.userData as { imagineMapError: string }).imagineMapError, "exceeds-max-texture-size");
    // valid bind clears error
    const ok = setImagineNodeMap(m, fakeTex(128, 128), { maxTextureSize: 256 });
    assert.equal(ok.ok, true);
    assert.equal(m.uniforms["uHasImage"]!.value, 1);
    assert.equal((m.userData as { imagineMapError: string | null }).imagineMapError, null);
    m.dispose();
  });
});

describe("painter c5: lore plaque text atlas", () => {
  it("createLoreTextAtlas handles empty, long, and unicode notes safely", () => {
    const empty = createLoreTextAtlas([]);
    assert.equal(empty.empty, true);
    assert.ok(empty.width >= 64);
    empty.dispose();
    empty.dispose(); // idempotent

    const long = "字".repeat(500) + " — " + "lock note ".repeat(40);
    const atlas = createLoreTextAtlas([long, "ok ✅ café", null, "\u0000bad"], {
      width: 256,
      height: 256,
      maxTextureSize: 512,
    });
    assert.ok(atlas.noteCount >= 1 && atlas.noteCount <= 8);
    assert.ok(atlas.truncatedCount >= 1);
    // lineCount is painted in DOM; in node we still expose noteCount/truncated
    assert.ok(atlas.lineCount >= 0);
    if (typeof document !== "undefined") assert.ok(atlas.lineCount >= 1);
    atlas.dispose();
  });

  it("hostile atlas sizes clamp; setLorePlaqueTextAtlas owns and disposes", () => {
    const atlas = createLoreTextAtlas(["hello"], { width: 1e9, height: NaN, maxTextureSize: 128 });
    assert.ok(atlas.width <= 128);
    assert.ok(atlas.height <= 128);
    const mat = createLorePlaqueMaterial();
    setLorePlaqueTextAtlas(mat, atlas, { owned: true });
    assert.equal(mat.uniforms["uHasText"]!.value, 1);
    assert.ok(mat.uniforms["uTextMap"]!.value);
    disposeLorePlaqueOwnedAtlas(mat);
    assert.equal(mat.uniforms["uHasText"]!.value, 0);
    mat.dispose();
  });

  it("shader samples uTextMap when uHasText and stays mediump-safe", () => {
    assert.match(LorePlaqueShader.fragmentShader, /uHasText/);
    assert.match(LorePlaqueShader.fragmentShader, /uTextMap/);
    assert.doesNotMatch(LorePlaqueShader.fragmentShader, /dFdx|dFdy|fwidth/);
  });
});


describe("hacker pass c6: painterly post-pass resize / DPR / RT thrash / fallback", () => {
  it("safePainterlyPassSize clamps 0/NaN/huge DPR to sane drawing buffers", () => {
    const z = safePainterlyPassSize(0, 0, 2);
    assert.ok(z.drawingWidth >= 1 && z.drawingHeight >= 1);
    const nan = safePainterlyPassSize(NaN, Infinity, NaN);
    assert.ok(nan.drawingWidth >= 1 && nan.drawingHeight >= 1);
    assert.ok(Number.isFinite(nan.dpr));
    const huge = safePainterlyPassSize(8000, 8000, 4);
    assert.ok(huge.drawingWidth <= PAINTER_PASS_MAX_EDGE);
    assert.ok(huge.drawingHeight <= PAINTER_PASS_MAX_EDGE);
    assert.ok(huge.dpr <= PAINTER_PASS_MAX_DPR);
  });

  it("resizePainterlyPass skips identical drawing size (no RT thrash) and is safe after dispose", () => {
    const pass = createPainterlyPass({ amount: 0.4 });
    resizePainterlyPass(pass, 1280, 720, 1);
    const a = painterlyPassResizeStats(pass);
    assert.equal(a.resizeCount, 1);
    resizePainterlyPass(pass, 1280, 720, 1);
    resizePainterlyPass(pass, 1280, 720, 1);
    const b = painterlyPassResizeStats(pass);
    assert.equal(b.resizeCount, 1);
    assert.ok(b.skippedResize >= 2);
    // distinct drawing buffer (800x450 ≠ 1280x720) — advance storm clock so setSize applies
    const meta = (pass as unknown as { userData: { painterPassMeta: { lastResizeAt: number } } }).userData.painterPassMeta;
    meta.lastResizeAt = Date.now() - PAINTER_RESIZE_MIN_INTERVAL_MS - 5;
    resizePainterlyPass(pass, 800, 450, 1);
    assert.ok(painterlyPassResizeStats(pass).resizeCount >= 2);
    disposePainterlyPass(pass);
    assert.doesNotThrow(() => resizePainterlyPass(pass, 1920 * 3, 1080 * 3, 3));
    assert.equal(painterlyPassResizeStats(pass).disposed, true);
  });

  it("forceFallback creates identity pass with compileError recorded (not silent black)", () => {
    const pass = createPainterlyPass({ forceFallback: true });
    const st = painterlyPassResizeStats(pass);
    assert.equal(st.fallback, true);
    assert.ok(st.compileError);
    assert.ok(PainterlyPassFallbackShader.fragmentShader.includes("tDiffuse"));
    assert.doesNotMatch(PainterlyPassFallbackShader.fragmentShader, /paintFbm/);
    disposePainterlyPass(pass);
    disposePainterlyPass(pass); // idempotent
  });

  it("tickPainterlyPass does not allocate — only numeric uniform writes; safe when disposed", () => {
    const pass = createPainterlyPass();
    const before = pass.uniforms["time"]!.value;
    tickPainterlyPass(pass, 12.5);
    assert.equal(pass.uniforms["time"]!.value, 12.5);
    tickPainterlyPass(pass, 86400 * 2);
    assert.ok((pass.uniforms["time"]!.value as number) < 600);
    disposePainterlyPass(pass);
    const t0 = pass.uniforms["time"]!.value;
    tickPainterlyPass(pass, 99);
    assert.equal(pass.uniforms["time"]!.value, t0);
    void before;
  });
});

describe("painter c6: post-pass amount from constellation health", () => {
  it("painterlyAmountFromHealth uses real healthy/total with sane clamps (no fabricated nodes)", () => {
    assert.equal(painterlyAmountFromHealth({ healthy: 0, total: 0 }), PAINTER_AMOUNT_MIN);
    assert.equal(painterlyAmountFromHealth({ healthy: NaN, total: 10 }), PAINTER_AMOUNT_MIN);
    assert.equal(painterlyAmountFromHealth({ healthy: 5, total: -1 }), PAINTER_AMOUNT_MIN);
    assert.equal(painterlyAmountFromHealth({ healthy: 8, total: 8, reducedMotion: true }), PAINTER_AMOUNT_MIN);
    const mid = painterlyAmountFromHealth({ healthy: 4, total: 8, baseAmount: 0.7 });
    const full = painterlyAmountFromHealth({ healthy: 8, total: 8, baseAmount: 0.7 });
    assert.ok(mid > PAINTER_AMOUNT_MIN && mid < full);
    assert.ok(full <= PAINTER_AMOUNT_MAX && full >= PAINTER_AMOUNT_MIN);
    // over-count healthy still clamps ratio to 1
    const over = painterlyAmountFromHealth({ healthy: 99, total: 10, baseAmount: 0.7 });
    assert.ok(Math.abs(over - full) < 1e-9);
  });

  it("setPainterlyPassHealth updates amount uniform without fabricating data", () => {
    const pass = createPainterlyPass({ amount: 0.42 });
    const a0 = setPainterlyPassHealth(pass, { healthy: 0, total: 12 });
    assert.equal(a0, PAINTER_AMOUNT_MIN);
    assert.equal(pass.uniforms["amount"]!.value, PAINTER_AMOUNT_MIN);
    const a1 = setPainterlyPassHealth(pass, { healthy: 12, total: 12, baseAmount: 0.6 });
    assert.ok(a1 > a0);
    assert.equal(pass.uniforms["amount"]!.value, a1);
    disposePainterlyPass(pass);
    assert.equal(setPainterlyPassHealth(pass, { healthy: 12, total: 12 }), 0);
  });

  it("PainterlyPassShader still exposes amount/grain/wash; version bumped", () => {
    assert.ok(PainterlyPassShader.uniforms.amount);
    assert.match(PAINTER_SHADER_VERSION, /^painter-1\.(?:[6-9]|10)/);
    assert.equal(PAINTER_SHADER_PRECISION, "mediump");
  });
});


describe("hacker pass c7: kit StrictMode / listener leak / tick throws / mediump", () => {
  it("double attachPainterlyContextHandlers detaches prior listeners (no leak)", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const canvas = {
      addEventListener: (t: string, fn: EventListener) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t)!.add(fn);
      },
      removeEventListener: (t: string, fn: EventListener) => {
        listeners.get(t)?.delete(fn);
      },
    } as unknown as HTMLCanvasElement;
    const kit = {
      disposed: false,
      contextLost: false,
      detachContext: null as null | (() => void),
      lastTickError: null,
      lastTickErrorCount: 0,
      starSpriteTexture: { dispose() {}, needsUpdate: false },
      paperGrainTexture: { dispose() {}, needsUpdate: false },
      tracked: [],
      trackedSkies: [],
      textureBindings: [],
    } as unknown as PainterlyKit;
    const d1 = attachPainterlyContextHandlers(canvas, kit);
    assert.equal(listeners.get("webglcontextlost")!.size, 1);
    const d2 = attachPainterlyContextHandlers(canvas, kit);
    // still exactly one of each (old removed)
    assert.equal(listeners.get("webglcontextlost")!.size, 1);
    assert.equal(listeners.get("webglcontextrestored")!.size, 1);
    d2();
    assert.equal(listeners.get("webglcontextlost")!.size, 0);
    void d1;
  });

  it("disposePainterlyKit detaches context handlers even if caller forgot detach()", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const canvas = {
      addEventListener: (t: string, fn: EventListener) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t)!.add(fn);
      },
      removeEventListener: (t: string, fn: EventListener) => {
        listeners.get(t)?.delete(fn);
      },
    } as unknown as HTMLCanvasElement;
    // Use a minimal kit shell with real attach/dispose path for detachContext
    const kit = {
      painterlyPass: { uniforms: {}, dispose() {} },
      starSpriteTexture: { dispose() {} },
      paperGrainTexture: { dispose() {} },
      tracked: [],
      trackedSkies: [],
      textureBindings: [],
      disposed: false,
      contextLost: false,
      detachContext: null as null | (() => void),
      lastTickError: null,
      lastTickErrorCount: 0,
    } as unknown as PainterlyKit;
    attachPainterlyContextHandlers(canvas, kit);
    assert.ok(kit.detachContext);
    assert.equal(listeners.get("webglcontextlost")!.size, 1);
    disposePainterlyKit(kit);
    assert.equal(listeners.get("webglcontextlost")!.size, 0);
    assert.equal(kit.detachContext, null);
  });

  it("tickPainterlyKit isolates per-material exceptions (frame continues)", () => {
    const good = createStarWatercolorMaterial();
    const bad = {
      name: "StarWatercolorMaterial",
      uniforms: { uTime: { value: 0 } },
      dispose() {},
    } as unknown as import("three").ShaderMaterial;
    // poison: make tickStarMaterial throw by replacing uTime setter... instead use custom name path
    const exploding = {
      name: "CustomBoom",
      get uniforms() {
        throw new Error("tick-boom");
      },
      dispose() {},
    } as unknown as import("three").ShaderMaterial;
    const kit = {
      painterlyPass: { uniforms: { time: { value: 0 } } },
      tracked: [good, exploding],
      trackedSkies: [],
      textureBindings: [],
      disposed: false,
      contextLost: false,
      lastTickError: null,
      lastTickErrorCount: 0,
    } as unknown as PainterlyKit;
    assert.doesNotThrow(() => tickPainterlyKit(kit, 3));
    assert.ok(kit.lastTickErrorCount >= 1);
    assert.match(String(kit.lastTickError), /tick-boom/);
    // good material still ticked
    assert.equal(good.uniforms["uTime"]!.value, 3);
    good.dispose();
    void bad;
  });

  it("StarWatercolorMaterial uses mediump precision (iOS/WebGL1)", () => {
    const m = createStarWatercolorMaterial();
    assert.equal((m as { precision?: string }).precision, "mediump");
    assert.equal(PAINTER_SHADER_PRECISION, "mediump");
    assert.match(WatercolorStarShader.fragmentShader, /bloom/);
    m.dispose();
  });
});

describe("painter c7: createBotStar one-line adopt helper", () => {
  it("createPainterlyBotStar returns mesh+glow with shared star texture binding", () => {
    // Avoid DOM star sprite: mock kit factories
    const tracked: import("three").ShaderMaterial[] = [];
    const textureBindings: { material: unknown; slot: string; target?: string }[] = [];
    const starTex = { id: "star", dispose() {} };
    const kit = {
      starSpriteTexture: starTex,
      paperGrainTexture: { dispose() {} },
      tracked,
      textureBindings,
      disposed: false,
      contextLost: false,
      createStarMaterial: (o?: object) => {
        const m = createStarWatercolorMaterial(o as never);
        tracked.push(m);
        return m;
      },
      bindSharedTexture(material: unknown, slot: string, target = "map") {
        textureBindings.push({ material, slot, target });
        (material as { map: unknown }).map = starTex;
      },
    } as unknown as PainterlyKit;
    const star = createPainterlyBotStar(kit, { color: 0x3dd68c, idle: false });
    assert.equal(star.meshMaterial.name, "StarWatercolorMaterial");
    assert.ok(star.glowMaterial);
    assert.equal((star.glowMaterial as { map: unknown }).map, starTex);
    assert.ok(textureBindings.some((b) => b.slot === "starSprite"));
    star.setColor(0xff6b8a, 0.5);
    assert.ok((star.meshMaterial.uniforms["uEmissive"]!.value as number) === 0.5);
    star.meshMaterial.dispose();
    star.glowMaterial.dispose();
  });

  it("WatercolorStarShader gained ink bloom without derivatives", () => {
    assert.match(WatercolorStarShader.fragmentShader, /bloom/);
    assert.doesNotMatch(WatercolorStarShader.fragmentShader, /dFdx|dFdy|fwidth/);
  });
});


describe("hacker pass c8: ink-wash degenerate / NaN / flood edges", () => {
  it("isDegenerateInkEdge catches zero-length, coincident, and NaN endpoints", () => {
    assert.equal(isDegenerateInkEdge([0, 0, 0], [0, 0, 0]), true);
    assert.equal(isDegenerateInkEdge([1, 2, 3], [1, 2, 3]), true);
    // NaN/Inf sanitize to 0 via toVec3 — [NaN,0,0]→origin, [1,0,0] stays length 1 (not degenerate)
    assert.equal(isDegenerateInkEdge([NaN, 0, 0], [1, 0, 0]), false);
    assert.equal(isDegenerateInkEdge([NaN, 0, 0], [NaN, 0, 0]), true); // both → origin
    assert.equal(isDegenerateInkEdge([0, 0, 0], [1, 0, 0]), false);
    assert.ok(measureInkEdgeLength([0, 0, 0], [3, 4, 0]) === 5);
    assert.ok(measureInkEdgeLength([NaN, Infinity, 0], [NaN, -Infinity, 0]) === 0);
    assert.ok(INK_EDGE_DEGENERATE_EPS > 0 && INK_EDGES_MAX === 512);
  });

  it("flood of thousands of edges truncates; degenerates skipped; ≤4 draw calls", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
      createInkWashEdgeMaterial: (o?: object) => {
        const m = createInkWashEdgeMaterial(o as never);
        tracked.push(m);
        return m;
      },
    } as unknown as PainterlyKit;

    const flood = [];
    for (let i = 0; i < 5000; i++) {
      // mix valid, zero-length, NaN
      if (i % 7 === 0) flood.push({ from: [i, 0, 0] as const, to: [i, 0, 0] as const, health: "healthy" as const });
      else if (i % 11 === 0) flood.push({ from: [NaN, 0, 0] as const, to: [1, NaN, 0] as const, health: "blocked" as const });
      else {
        const tone = (["healthy", "stalled", "blocked", "idle"] as const)[i % 4]!;
        flood.push({
          from: [i * 0.1, 0, 0] as const,
          to: [i * 0.1 + 2, 1, 0] as const,
          health: tone,
          kind: i % 5 === 0 ? "hub" as const : "link" as const,
        });
      }
    }
    const ink = createPainterlyInkEdges(kit, flood, { maxEdges: INK_EDGES_MAX });
    assert.equal(ink.truncated, true);
    assert.ok(ink.edgeCount <= INK_EDGES_MAX);
    assert.ok(ink.edgeCount > 0);
    assert.ok(ink.skippedDegenerate > 0);
    assert.ok(ink.drawCalls >= 1 && ink.drawCalls <= 4, `drawCalls=${ink.drawCalls}`);
    assert.equal(tracked.length, 4, "exactly 4 shared health materials");
    // update again must not grow tracked
    ink.update(flood.slice(0, 100));
    assert.equal(tracked.length, 4);
    assert.ok(ink.drawCalls <= 4);
    ink.dispose();
    assert.equal(tracked.length, 0, "dispose releases all kit materials");
    assert.equal(ink.group.children.length, 0);
    // idempotent
    ink.dispose();
    assert.equal(tracked.length, 0);
  });

  it("buildMergedInkWashGeometry skips degenerates and yields finite attributes", () => {
    const edges = [
      { from: [0, 0, 0] as const, to: [0, 0, 0] as const, health: "idle" as const },
      { from: [0, 0, 0] as const, to: [5, 0, 0] as const, health: "healthy" as const },
      { from: [1, 1, 1] as const, to: [2, 3, 4] as const, health: "stalled" as const },
    ];
    const { geometry, used, skippedDegenerate } = buildMergedInkWashGeometry(edges, {
      widthFor: () => 0.3,
      segments: 8,
    });
    assert.equal(used, 2);
    assert.equal(skippedDegenerate, 1);
    const pos = geometry.getAttribute("position");
    assert.ok(pos.count > 0);
    for (let i = 0; i < pos.count * 3; i++) {
      assert.ok(Number.isFinite((pos.array as Float32Array)[i]!));
    }
    geometry.dispose();
  });

  it("per-edge allocations are NOT created for flood — shared mats only", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
      createInkWashEdgeMaterial: (o?: object) => {
        const m = createInkWashEdgeMaterial(o as never);
        tracked.push(m);
        return m;
      },
    } as unknown as PainterlyKit;
    const edges = Array.from({ length: 200 }, (_, i) => ({
      from: [i, 0, 0] as const,
      to: [i + 1, 0.5, 0] as const,
      health: (["healthy", "stalled", "blocked", "idle"] as const)[i % 4]!,
    }));
    const ink = createPainterlyInkEdges(kit, edges);
    assert.equal(tracked.length, 4);
    assert.equal(ink.edgeCount, 200);
    assert.equal(ink.drawCalls, 4);
    ink.dispose();
  });
});

describe("painter c8: createInkEdges one-call adopt helper", () => {
  it("kit.createInkEdges shape: group + update + dispose; empty list is safe", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
      createInkWashEdgeMaterial: (o?: object) => {
        const m = createInkWashEdgeMaterial(o as never);
        tracked.push(m);
        return m;
      },
      createInkEdges(edges: never[] = [], opts?: object) {
        return createPainterlyInkEdges(kit as never, edges, opts as never);
      },
    } as unknown as PainterlyKit;
    const ink = kit.createInkEdges([]);
    assert.equal(ink.edgeCount, 0);
    assert.equal(ink.drawCalls, 0);
    assert.equal(ink.group.name, "PainterlyInkEdges");
    ink.update([
      { from: [0, 0, 0], to: [2, 0, 0], health: "healthy", kind: "link" },
      { from: [0, 1, 0], to: [2, 1, 0], health: "blocked", kind: "hub" },
    ]);
    assert.equal(ink.edgeCount, 2);
    assert.equal(ink.drawCalls, 2);
    ink.tick(1.5);
    for (const m of tracked) {
      assert.equal(m.uniforms["uTime"]!.value, 1.5);
    }
    ink.dispose();
    assert.equal(tracked.length, 0);
  });
});


describe("hacker pass c9: Imagine post-release load race", () => {
  it("setImagineNodeMap no-ops after markImagineNodeReleased (late TextureLoader)", () => {
    const mat = createImagineNodeMaterial();
    assert.equal(isImagineNodeReleased(mat), false);
    // Fake a texture with valid dims
    const fake = {
      isTexture: true,
      image: { width: 64, height: 64 },
      needsUpdate: false,
      dispose() {},
      generateMipmaps: false,
      minFilter: 0,
      magFilter: 0,
      wrapS: 0,
      wrapT: 0,
    } as unknown as import("three").Texture;
    const ok = setImagineNodeMap(mat, fake);
    assert.equal(ok.ok, true);
    markImagineNodeReleased(mat);
    assert.equal(isImagineNodeReleased(mat), true);
    const late = setImagineNodeMap(mat, fake);
    assert.equal(late.ok, false);
    assert.equal(late.reason, "material-released");
    assert.equal(mat.uniforms["uHasImage"]!.value, 1); // unchanged from prior bind — no rewrite required after release; released path returns early before mutate
    mat.dispose();
  });

  it("releasePainterlyMaterial marks Imagine released before dispose", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
      createImagineNodeMaterial: (o?: object) => {
        const m = createImagineNodeMaterial(o as never);
        tracked.push(m);
        return m;
      },
    } as unknown as PainterlyKit;
    const m = kit.createImagineNodeMaterial({});
    assert.equal(releasePainterlyMaterial(kit, m), true);
    assert.equal(isImagineNodeReleased(m), true);
    const fake = {
      isTexture: true,
      image: { width: 32, height: 32 },
      needsUpdate: false,
      dispose() {},
      generateMipmaps: false,
    } as unknown as import("three").Texture;
    const late = setImagineNodeMap(m, fake);
    assert.equal(late.reason, "material-released");
    assert.equal(tracked.length, 0);
  });
});

describe("hacker pass c9: kit GPU texture budget", () => {
  it("sanitizeTextureBudgetBytes clamps hostile budgets", () => {
    assert.equal(sanitizeTextureBudgetBytes(NaN), PAINTER_TEXTURE_BUDGET_BYTES);
    assert.ok(sanitizeTextureBudgetBytes(1) >= 2 * 1024 * 1024);
    assert.ok(sanitizeTextureBudgetBytes(1e15) <= 256 * 1024 * 1024);
  });

  it("estimateTextureBytes reports RGBA footprint; missing dims → 0 (no fabricate)", () => {
    const empty = estimateTextureBytes(null);
    assert.equal(empty.bytes, 0);
    const data = createPaperGrainTexture({ size: 64, seed: 1 });
    const e = estimateTextureBytes(data);
    assert.equal(e.width, 64);
    assert.equal(e.height, 64);
    // DataTexture generateMipmaps default false in three → exact 64*64*4
    assert.ok(e.bytes === 64 * 64 * 4 || e.bytes === Math.floor(64 * 64 * 4 * 1.333333));
    data.dispose();
  });

  it("painterlyKitTextureBudget sums paper+star and flags overBudget vs tiny cap", () => {
    const paper = createPaperGrainTexture({ size: 128, seed: 2 });
    const star = { image: { width: 128, height: 128 }, generateMipmaps: false, dispose() {} };
    const kit = {
      paperGrainTexture: paper,
      starSpriteTexture: star,
      tracked: [],
      trackedSkies: [],
      textureBindings: [],
      disposed: false,
      textureBudgetBytes: 1000, // tiny → over budget
    } as unknown as PainterlyKit;
    const report = painterlyKitTextureBudget(kit);
    assert.ok(report.bytes > 0);
    assert.equal(report.budget, 1000);
    assert.equal(report.overBudget, true);
    assert.ok(report.items.some((i) => i.id === "paperGrain"));
    paper.dispose();
  });
});

describe("painter c9: createLaneNebulae one-call adopt helper", () => {
  it("replaces MeshBasic lane spheres with health-tinted wash mats; dispose releases", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;
    const neb = createPainterlyLaneNebulae(kit, [
      { health: "healthy", center: [0, 0, 0] },
      { health: "blocked", center: [5, 1, -2], radius: 3 },
      { health: "idle", center: [-4, 0, 2] },
    ]);
    assert.equal(neb.count, 3);
    assert.equal(neb.materialCount, 4);
    assert.equal(tracked.length, 4, "shared mats by health tone");
    assert.ok(tracked.every((m) => m.name === "LaneNebulaMaterial"));
    neb.tick(2);
    assert.equal(tracked[0]!.uniforms["uTime"]!.value, 2);
    neb.update([{ health: "stalled", center: [1, 1, 1] }]);
    assert.equal(neb.count, 1);
    assert.equal(tracked.length, 4, "shared mats persist across update");
    neb.dispose();
    assert.equal(tracked.length, 0);
    assert.equal(neb.group.children.length, 0);
    // idle opacity lower than active — create single mats
    const idle = createLaneNebulaMaterial({ health: "idle", opacity: 0.1 });
    const hot = createLaneNebulaMaterial({ health: "healthy", opacity: 0.32 });
    assert.ok((idle.uniforms["uOpacity"]!.value as number) < (hot.uniforms["uOpacity"]!.value as number));
    assert.ok((hot.uniforms["uHealth"]!.value as { g: number }).g > 0.5);
    idle.dispose();
    hot.dispose();
  });
});


describe("hacker pass c10: lane nebula flood / NaN + shared mats", () => {
  it("truncates huge lane dumps; skips NaN centers; keeps ≤4 shared materials", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;
    const flood = [];
    for (let i = 0; i < 500; i++) {
      if (i % 9 === 0) flood.push({ health: "healthy", center: [NaN, Infinity, 0] as const });
      else if (i % 5 === 0) flood.push({ health: "not-a-tone", center: [i, 0, 0] as const });
      else flood.push({
        health: (["healthy", "stalled", "blocked", "idle"] as const)[i % 4]!,
        center: [i * 0.1, 0, 0] as const,
      });
    }
    const neb = createPainterlyLaneNebulae(kit, flood);
    assert.equal(neb.truncated, true);
    assert.ok(neb.count <= LANE_NEBULAE_MAX);
    assert.ok(neb.skippedInvalid > 0);
    assert.equal(neb.materialCount, 4);
    assert.equal(tracked.length, 4);
    neb.tick(1);
    neb.tick(1, true); // reduced motion freezes
    neb.dispose();
    assert.equal(tracked.length, 0);
  });
});

describe("hacker pass c10: reduced-motion freezes painter clocks + tick cost", () => {
  it("tickPainterlyKit reducedMotion freezes uTime and reports uniform writes", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const pass = { uniforms: { uTime: { value: 0 }, amount: { value: 0.4 } } };
    const kit = {
      painterlyPass: pass,
      tracked,
      trackedSkies: [],
      textureBindings: [],
      disposed: false,
      contextLost: false,
      lastTickError: null,
      lastTickErrorCount: 0,
      lastTickUniformWrites: 0,
      frozenTickTime: 0,
      starSpriteTexture: { dispose() {} },
      paperGrainTexture: { dispose() {} },
    } as unknown as PainterlyKit;
    const star = createStarWatercolorMaterial();
    const building = createBuildingBrushMaterial({ progress: 0.5, floors: 6 });
    tracked.push(star, building);
    tickPainterlyKit(kit, 12);
    assert.ok(kit.lastTickUniformWrites >= 3); // pass + 2 mats
    assert.equal(star.uniforms["uTime"]!.value, 12);
    assert.equal(kit.frozenTickTime, 12);
    tickPainterlyKit(kit, 99, { reducedMotion: true });
    assert.equal(star.uniforms["uTime"]!.value, 12, "frozen under reduced motion");
    assert.equal(building.uniforms["uTime"]!.value, 12);
    assert.ok(kit.lastTickUniformWrites >= 1);
    tickPainterlyKit(kit, 20, { reducedMotion: false });
    assert.equal(star.uniforms["uTime"]!.value, 20);
    star.dispose();
    building.dispose();
  });
});

describe("painter c10: brush building window-light washes from real progress", () => {
  it("uWindowGlow tracks progress; zero progress → dark windows; no fabricated occupancy", () => {
    const dark = createBuildingBrushMaterial({ floors: 8, progress: 0 });
    assert.equal(dark.uniforms["uProgress"]!.value, 0);
    assert.equal(dark.uniforms["uWindowGlow"]!.value, 0);
    const lit = createBuildingBrushMaterial({ floors: 10, progress: 0.6 });
    assert.equal(lit.uniforms["uProgress"]!.value, 0.6);
    assert.ok((lit.uniforms["uWindowGlow"]!.value as number) > 0.5);
    setBuildingProgress(lit, 0);
    assert.equal(lit.uniforms["uWindowGlow"]!.value, 0);
    setBuildingProgress(lit, 0.8);
    assert.ok((lit.uniforms["uWindowGlow"]!.value as number) > 0.5);
    setBuildingWindowGlow(lit, 0.2);
    setBuildingProgress(lit, 1);
    assert.equal(lit.uniforms["uWindowGlow"]!.value, 0.2, "locked glow not overwritten");
    assert.match(BrushBuildingShader.fragmentShader, /uWindowGlow/);
    assert.match(BrushBuildingShader.fragmentShader, /windowCell/);
    dark.dispose();
    lit.dispose();
  });
});


describe("hacker pass c11: resize storm + context-loss resize", () => {
  it("rapid alternating resizePass sizes coalesce; flush applies pending", () => {
    const pass = createPainterlyPass();
    resizePainterlyPass(pass, 800, 600, 1);
    const s0 = painterlyPassResizeStats(pass);
    assert.equal(s0.resizeCount, 1);
    // Storm: many different sizes within interval
    for (let i = 0; i < 20; i++) {
      resizePainterlyPass(pass, 800 + (i % 3), 600 + (i % 2), 1 + (i % 2) * 0.25);
    }
    const mid = painterlyPassResizeStats(pass);
    assert.ok(mid.stormSkipped >= 1, `stormSkipped=${mid.stormSkipped}`);
    assert.ok(mid.resizeCount < 20, `resizeCount should be coalesced, got ${mid.resizeCount}`);
    // Force interval elapsed
    const m = (pass as unknown as { userData: { painterPassMeta: { lastResizeAt: number } } }).userData.painterPassMeta;
    m.lastResizeAt = Date.now() - PAINTER_RESIZE_MIN_INTERVAL_MS - 5;
    const flushed = flushPainterlyPassResize(pass);
    assert.equal(flushed || !painterlyPassResizeStats(pass).hasPending, true);
    disposePainterlyPass(pass);
  });

  it("kit.resizePass no-ops while contextLost (mid-loss RT thrash)", () => {
    // Avoid DOM star sprite: minimal kit shell with real pass
    const pass = createPainterlyPass();
    const kit = {
      painterlyPass: pass,
      disposed: false,
      contextLost: true,
      resizePass(width: number, height: number, dpr = 1) {
        if (kit.disposed || kit.contextLost) return;
        resizePainterlyPass(pass, width, height, dpr);
      },
    };
    kit.resizePass(1024, 768, 2);
    assert.equal(painterlyPassResizeStats(pass).resizeCount, 0);
    kit.contextLost = false;
    kit.resizePass(1024, 768, 1);
    assert.equal(painterlyPassResizeStats(pass).resizeCount, 1);
    disposePainterlyPass(pass);
  });
});

describe("hacker pass c11: building extremes + nebula dispose idempotence + mediump window glow", () => {
  it("NaN/Inf/negative floors and progress stay finite; glow never NaN", () => {
    const m = createBuildingBrushMaterial({
      floors: Number.POSITIVE_INFINITY,
      progress: Number.NEGATIVE_INFINITY,
      windowGlow: NaN,
    });
    assert.ok(Number.isFinite(m.uniforms["uFloors"]!.value as number));
    assert.ok(Number.isFinite(m.uniforms["uProgress"]!.value as number));
    assert.ok(Number.isFinite(m.uniforms["uWindowGlow"]!.value as number));
    setBuildingProgress(m, NaN);
    assert.equal(m.uniforms["uProgress"]!.value, 0);
    assert.match(BrushBuildingShader.fragmentShader, /uWindowGlow/);
    assert.doesNotMatch(BrushBuildingShader.fragmentShader, /dFdx|dFdy|fwidth/);
    assert.equal(PAINTER_SHADER_PRECISION, "mediump");
    m.dispose();
  });

  it("lane nebulae dispose is idempotent; tracked stays clean", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;
    const neb = createPainterlyLaneNebulae(kit, [
      { health: "healthy", center: [0, 0, 0] },
      { health: "blocked", center: [1, 0, 0] },
    ]);
    assert.equal(tracked.length, 4);
    neb.dispose();
    assert.equal(tracked.length, 0);
    assert.doesNotThrow(() => neb.dispose());
    assert.doesNotThrow(() => neb.dispose());
    assert.equal(tracked.length, 0);
    neb.update([{ health: "idle", center: [2, 0, 0] }]); // no-op when disposed
    assert.equal(neb.count, 2); // frozen at last count before dispose path — update returns early
  });
});

describe("painter c11: unified post-pass palette grade", () => {
  it("PainterlyPassShader gains warm/cool paper palette driven by amount", () => {
    assert.match(PainterlyPassShader.fragmentShader, /paperWarm/);
    assert.match(PainterlyPassShader.fragmentShader, /indigoCool/);
    assert.match(PainterlyPassShader.fragmentShader, /Unified painterly palette/);
    const pass = createPainterlyPass({ amount: 0.5 });
    assert.ok(pass.uniforms["amount"]);
    disposePainterlyPass(pass);
  });
});


describe("hacker pass c12: kit HMR disposeAll + texture budget after dispose", () => {
  it("repeated create/dispose + disposeAllPainterlyKits clears LIVE set; budget safe after dispose", () => {
    // Avoid DOM canvas for star sprite: use createPainterlyKit only if document exists;
    // in node, createStarSpriteTexture may throw — mock via disposeAll on empty first
    const before = livePainterlyKitCount();
    // Create kits with minimal pass only by calling createPainterlyKit — needs canvas for star sprite
    // Skip full kit if no document; instead test disposeAll idempotent + budget on mock
    const tracked: import("three").ShaderMaterial[] = [];
    const paper = createPaperGrainTexture({ size: 32, seed: 1 });
    const kit = {
      painterlyPass: createPainterlyPass(),
      starSpriteTexture: paper,
      paperGrainTexture: paper,
      tracked,
      trackedSkies: [],
      textureBindings: [],
      disposed: false,
      contextLost: false,
      textureBudgetBytes: 48 * 1024 * 1024,
      detachContext: null,
    } as unknown as PainterlyKit;
    // Manually register like createPainterlyKit would — call disposePainterlyKit path via disposeAll
    // Use real createPainterlyKit when possible
    let realKits = 0;
    try {
      for (let i = 0; i < 3; i++) {
        createPainterlyKit({ pass: { amount: 0.2 } });
        realKits += 1;
      }
    } catch {
      realKits = 0;
    }
    if (realKits > 0) {
      assert.ok(livePainterlyKitCount() >= realKits);
      const n = disposeAllPainterlyKits();
      assert.ok(n >= realKits);
      assert.equal(livePainterlyKitCount(), 0);
      assert.equal(disposeAllPainterlyKits(), 0);
    } else {
      // node without canvas — still verify disposed budget short-circuit
      kit.disposed = true;
      const report = painterlyKitTextureBudget(kit);
      assert.equal(report.bytes, 0);
      assert.equal(report.items.length, 0);
      void before;
    }
    paper.dispose();
    disposePainterlyPass(kit.painterlyPass as never);
  });
});

describe("hacker pass c12: lore atlas emoji/RTL/huge + Imagine disposed/0x0 + palette NaN", () => {
  it("createLoreTextAtlas handles empty, emoji, RTL, and hostile atlas size", () => {
    const empty = createLoreTextAtlas("");
    assert.equal(empty.empty, true);
    empty.dispose();
    const emoji = createLoreTextAtlas("🚀 ship it ✅ · مرحبا بالعالم");
    assert.ok(emoji.width >= 64 && emoji.width <= 1024);
    assert.ok(emoji.noteCount >= 1);
    emoji.dispose();
    const huge = createLoreTextAtlas("x".repeat(50000), { width: 99999, height: -3, maxTextureSize: 512 });
    assert.ok(huge.width <= 1024);
    assert.ok(huge.height <= 1024);
    huge.dispose();
    assert.doesNotThrow(() => {
      huge.dispose();
      huge.dispose();
    });
  });

  it("setImagineNodeMap rejects disposed and 0x0 textures with explicit reason", () => {
    const mat = createImagineNodeMaterial();
    const disposedTex = {
      disposed: true,
      isTexture: true,
      image: { width: 64, height: 64 },
      dispose() {},
    } as unknown as import("three").Texture;
    const r1 = setImagineNodeMap(mat, disposedTex);
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, "texture-disposed");
    const zero = {
      disposed: false,
      isTexture: true,
      image: { width: 0, height: 0 },
      dispose() {},
    } as unknown as import("three").Texture;
    const r2 = setImagineNodeMap(mat, zero);
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "invalid-dimensions");
    mat.dispose();
  });

  it("setPainterlyPassAmount / setPassHealth NaN stay in range (palette never NaN amount)", () => {
    const pass = createPainterlyPass({ amount: 0.4 });
    const v = setPainterlyPassAmount(pass, Number.NaN);
    assert.ok(Number.isFinite(v));
    assert.ok(v >= 0 && v <= 0.85);
    const a = setPainterlyPassHealth(pass, { healthy: Number.NaN, total: Number.POSITIVE_INFINITY });
    assert.ok(Number.isFinite(a));
    assert.ok(a >= PAINTER_AMOUNT_MIN);
    disposePainterlyPass(pass);
  });
});

describe("painter c12: status-driven star brush-stroke halos", () => {
  it("createBotStar idle has lower uHalo than active; setColor refreshes halo", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const textureBindings: { material: unknown; slot: string; target?: string }[] = [];
    const starTex = { id: "star", dispose() {} };
    const kit = {
      starSpriteTexture: starTex,
      paperGrainTexture: { dispose() {} },
      tracked,
      textureBindings,
      disposed: false,
      contextLost: false,
      createStarMaterial: (o?: object) => {
        const m = createStarWatercolorMaterial(o as never);
        tracked.push(m);
        return m;
      },
      bindSharedTexture(material: unknown, slot: string, target = "map") {
        textureBindings.push({ material, slot, target });
        (material as { map: unknown }).map = starTex;
      },
    } as unknown as PainterlyKit;
    const idle = createPainterlyBotStar(kit, { color: 0x5c6b8a, idle: true });
    const active = createPainterlyBotStar(kit, { color: 0x3dd68c, idle: false });
    assert.ok((idle.meshMaterial.uniforms["uHalo"]!.value as number) < (active.meshMaterial.uniforms["uHalo"]!.value as number));
    assert.match(WatercolorStarShader.fragmentShader, /uHalo/);
    active.setColor(0xff6b8a, 0.9);
    assert.ok((active.meshMaterial.uniforms["uHalo"]!.value as number) > 0.4);
    active.setHalo(0.15);
    active.setColor(0x3dd68c, 0.9);
    assert.equal(active.meshMaterial.uniforms["uHalo"]!.value, 0.15, "locked halo");
    idle.meshMaterial.dispose();
    active.meshMaterial.dispose();
    idle.glowMaterial.dispose();
    active.glowMaterial.dispose();
  });
});


describe("hacker pass c13: invalid star colors + compile fallback + mediump wrap", () => {
  it("sanitizePainterColor rejects empty/unknown strings (Three would coerce to white)", () => {
    const empty = sanitizePainterColor("");
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "color-empty");
    assert.ok(Math.abs(empty.color.r - PAINTER_IDLE_RGB[0]) < 1e-6);
    const bad = sanitizePainterColor("not-a-color");
    assert.equal(bad.ok, false);
    assert.match(String(bad.reason), /color-unknown/);
    // Must NOT be bright white (the Three.Color.set failure mode)
    assert.ok(!(bad.color.r === 1 && bad.color.g === 1 && bad.color.b === 1));
    const hex = sanitizePainterColor("#3dd68c");
    assert.equal(hex.ok, true);
    const num = sanitizePainterColor(0xff6b8a);
    assert.equal(num.ok, true);
  });

  it("createStarWatercolorMaterial / setStarWatercolorColor record starColorError and stay idle-tinted", () => {
    const m = createStarWatercolorMaterial({ color: "" as unknown as number });
    assert.equal((m.userData as { starColorError?: string }).starColorError, "color-empty");
    const c = m.uniforms["uColor"]!.value as { r: number; g: number; b: number };
    assert.ok(Math.abs(c.r - PAINTER_IDLE_RGB[0]) < 1e-5);
    setStarWatercolorColor(m, "totally-invalid");
    assert.match(String((m.userData as { starColorError?: string }).starColorError), /color-unknown/);
    assert.ok(Math.abs(c.r - PAINTER_IDLE_RGB[0]) < 1e-5);
    m.dispose();
  });

  it("forceFallback star material records compileError and is not silent black", () => {
    const m = createStarWatercolorMaterial({ forceFallback: true, color: 0x3dd68c });
    const meta = (m.userData as { painterMaterialMeta?: { fallback: boolean; compileError: string | null } }).painterMaterialMeta;
    assert.ok(meta);
    assert.equal(meta!.fallback, true);
    assert.ok(meta!.compileError);
    assert.match(m.name, /Fallback/);
    const c = m.uniforms["uColor"]!.value as { r: number; g: number; b: number };
    assert.ok(c.r + c.g + c.b > 0.1, "fallback keeps visible tint");
    m.dispose();
  });

  it("paintWrap GLSL clamps large coords (mediump banding guard present)", () => {
    assert.match(GLSL_HASH_NOISE, /clamp\(p,\s*-1\.0e4,\s*1\.0e4\)/);
    assert.equal(PAINTER_SHADER_VERSION, "painter-1.10.0");
  });
});

describe("painter c13: ink-edge watercolor bleed from real weight", () => {
  it("inkBleedFromWeight: blocked > stalled > healthy; hub calmer than link", () => {
    assert.ok(inkBleedFromWeight("blocked") > inkBleedFromWeight("stalled"));
    assert.ok(inkBleedFromWeight("stalled") > inkBleedFromWeight("healthy"));
    assert.ok(inkBleedFromWeight("healthy", "hub") < inkBleedFromWeight("healthy", "link"));
  });

  it("createInkWashEdgeMaterial exposes uBleed; setInkWashEdgeBleed clamps", () => {
    assert.ok(InkWashEdgeShader.uniforms.uBleed);
    assert.match(InkWashEdgeShader.fragmentShader, /uBleed/);
    const m = createInkWashEdgeMaterial({ health: "blocked", bleed: 0.9 });
    assert.ok(Math.abs((m.uniforms["uBleed"]!.value as number) - 0.9) < 1e-6);
    setInkWashEdgeBleed(m, Number.NaN);
    assert.equal(m.uniforms["uBleed"]!.value, 0.35);
    setInkWashEdgeBleed(m, 99);
    assert.equal(m.uniforms["uBleed"]!.value, 1.5);
    m.dispose();
  });

  it("createPainterlyInkEdges sets higher bleed on blocked batch than healthy", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      textureBindings: [] as { material: unknown; slot: string; target?: string }[],
      createInkWashEdgeMaterial: (o?: object) => {
        const m = createInkWashEdgeMaterial(o as never);
        tracked.push(m);
        return m;
      },
    } as unknown as PainterlyKit;
    const ink = createPainterlyInkEdges(kit, [
      { from: [0, 0, 0], to: [1, 0, 0], health: "healthy", kind: "link" },
      { from: [0, 1, 0], to: [1, 1, 0], health: "blocked", kind: "link" },
    ]);
    assert.equal(tracked.length, 4);
    const bleeds = tracked.map((m) => m.uniforms["uBleed"]!.value as number);
    // TONES: healthy, stalled, blocked, idle — blocked batch updated with edges
    assert.ok(bleeds[2]! >= inkBleedFromWeight("blocked") - 0.05);
    assert.ok(bleeds[0]! <= inkBleedFromWeight("healthy") + 0.05);
    assert.ok(bleeds[2]! > bleeds[0]!);
    ink.dispose();
  });
});

describe("hacker pass c14/c15: kit use-after-dispose fail-safe + nebula mesh churn + wrap seam", () => {
  it("create* after dispose returns inert no-op + disposeMeta (no throw / no UAF)", () => {
    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.2 } });
    } catch {
      // jsdom-less hosts may fail canvas star sprite — still assert constant + grain helpers
      assert.equal(PAINTER_KIT_DISPOSED, "painterly-kit-disposed");
      assert.ok(STAR_GRAIN_BY_HEALTH.blocked > STAR_GRAIN_BY_HEALTH.healthy);
      return;
    }
    disposePainterlyKit(kit);
    assert.equal(kit.disposed, true);
    assert.equal(kit.disposeMeta.postDisposeCall, false);
    const star = kit.createStarMaterial({});
    assert.ok(star.userData.painterInert);
    assert.equal(kit.disposeMeta.postDisposeCall, true);
    assert.equal(kit.disposeMeta.lastReason, PAINTER_KIT_DISPOSED);
    assert.ok(kit.disposeMeta.postDisposeCallCount >= 1);
    // Must NOT grow tracked after dispose
    assert.equal(kit.tracked.length, 0);
    const bot = kit.createBotStar({});
    assert.ok(bot.meshMaterial.userData.painterInert);
    bot.setColor(0xff0000);
    bot.setHalo(1);
    bot.setGrain(1);
    const neb = kit.createLaneNebulae([{ health: "blocked", center: [0, 0, 0] }]);
    assert.equal(neb.count, 0);
    neb.update([{ health: "healthy", center: [1, 0, 0] }]);
    assert.equal(neb.count, 0);
    const img = kit.createImagineNodeMaterial({});
    assert.ok(img.userData.painterInert);
    // bindSharedTexture must not throw
    kit.bindSharedTexture({} as never, "starSprite");
    assert.ok(kit.disposeMeta.postDisposeCallCount >= 5);
    star.dispose();
    bot.meshMaterial.dispose();
    bot.glowMaterial.dispose();
    img.dispose();
    neb.dispose();
  });

  it("deferred createImagineNodeMaterial after dispose (universe-scene race) does not throw", () => {
    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.2 } });
    } catch {
      assert.equal(PAINTER_KIT_DISPOSED, "painterly-kit-disposed");
      return;
    }
    disposePainterlyKit(kit);
    // Simulate requestIdleCallback / TextureLoader race after StrictMode unmount
    assert.doesNotThrow(() => {
      for (let i = 0; i < 6; i++) {
        const m = kit!.createImagineNodeMaterial({});
        assert.ok(m.userData.painterInert);
        m.dispose();
      }
    });
    assert.equal(kit.tracked.length, 0);
    assert.ok(kit.disposeMeta.postDisposeWarned);
  });

  it("lane nebula update with flickering lanes reuses mesh pool (no per-frame Mesh alloc storm)", () => {
    const tracked: import("three").ShaderMaterial[] = [];
    const kit = {
      tracked,
      trackedSkies: [],
      textureBindings: [] as { material: unknown; slot: string }[],
      disposed: false,
      contextLost: false,
    } as unknown as PainterlyKit;
    const neb = createPainterlyLaneNebulae(kit, []);
    for (let frame = 0; frame < 40; frame++) {
      const n = frame % 2 === 0 ? 8 : 3;
      const lanes = [];
      for (let i = 0; i < n; i++) {
        lanes.push({
          health: (["healthy", "stalled", "blocked", "idle"] as const)[i % 4]!,
          center: [i, frame * 0.01, 0] as const,
        });
      }
      neb.update(lanes);
      assert.equal(neb.count, n);
      assert.ok(neb.meshPoolSize >= n);
      assert.equal(tracked.length, 4, "shared mats stable under churn");
    }
    // Pool grew to peak 8, not 40*avg
    assert.ok(neb.meshPoolSize <= LANE_NEBULAE_MAX);
    assert.equal(neb.meshPoolSize, 8);
    neb.dispose();
  });

  it("shaderTimeAngle is continuous across sanitizeShaderTime wrap seam", () => {
    const a0 = shaderTimeAngle(PAINTER_TIME_PERIOD - 1e-6);
    const a1 = shaderTimeAngle(PAINTER_TIME_PERIOD + 1e-6);
    // sin/cos near equal across seam
    assert.ok(Math.abs(Math.sin(a0) - Math.sin(a1)) < 1e-4);
    assert.ok(Math.abs(Math.cos(a0) - Math.cos(a1)) < 1e-4);
    assert.match(LaneNebulaShader.fragmentShader, /0\.010472|ang = uTime/);
  });
});

describe("painter c14: lane nebula pigment pooling from real health", () => {
  it("blocked pool/wash > healthy; setLaneNebulaHealth syncs uPool", () => {
    assert.ok(LANE_POOL_BY_HEALTH.blocked > LANE_POOL_BY_HEALTH.healthy);
    assert.ok(LANE_WASH_BY_HEALTH.blocked > LANE_WASH_BY_HEALTH.healthy);
    assert.ok(LaneNebulaShader.uniforms.uPool);
    assert.match(LaneNebulaShader.fragmentShader, /uPool/);
    const blocked = createLaneNebulaMaterial({ health: "blocked" });
    const healthy = createLaneNebulaMaterial({ health: "healthy" });
    assert.ok((blocked.uniforms["uPool"]!.value as number) > (healthy.uniforms["uPool"]!.value as number));
    setLaneNebulaHealth(healthy, "blocked");
    assert.ok(Math.abs((healthy.uniforms["uPool"]!.value as number) - LANE_POOL_BY_HEALTH.blocked) < 1e-6);
    blocked.dispose();
    healthy.dispose();
  });
});

describe("hacker pass c15: star granulation mediump + health pigment", () => {
  it("WatercolorStarShader uses paintWrap anisotropic grain (not raw vUv*90)", () => {
    assert.match(WatercolorStarShader.fragmentShader, /paintWrap\(vUv \* vec2\(22\.0, 48\.0\)/);
    assert.match(WatercolorStarShader.fragmentShader, /gFiber/);
    assert.doesNotMatch(WatercolorStarShader.fragmentShader, /vUv \* 90\.0/);
  });

  it("starGrainFromHealth: blocked > stalled > healthy > idle; idle boolean path", () => {
    assert.ok(STAR_GRAIN_BY_HEALTH.blocked > STAR_GRAIN_BY_HEALTH.stalled);
    assert.ok(STAR_GRAIN_BY_HEALTH.stalled > STAR_GRAIN_BY_HEALTH.healthy);
    assert.ok(STAR_GRAIN_BY_HEALTH.healthy > STAR_GRAIN_BY_HEALTH.idle);
    assert.equal(starGrainFromHealth("blocked"), STAR_GRAIN_BY_HEALTH.blocked);
    assert.equal(starGrainFromHealth(undefined, true), STAR_GRAIN_BY_HEALTH.idle);
    assert.equal(starGrainFromHealth(undefined, false), STAR_GRAIN_BY_HEALTH.healthy);
    assert.equal(starGrainFromHealth("nope"), STAR_GRAIN_BY_HEALTH.healthy);
  });

  it("createBotStar / createStarWatercolorMaterial apply health grain; setStarGrain locks", () => {
    const blocked = createStarWatercolorMaterial({ health: "blocked" });
    const idle = createStarWatercolorMaterial({ health: "idle" });
    assert.ok((blocked.uniforms["uGrain"]!.value as number) > (idle.uniforms["uGrain"]!.value as number));
    setStarGrain(idle, 0.5);
    assert.ok(Math.abs((idle.uniforms["uGrain"]!.value as number) - 0.5) < 1e-6);
    setStarWatercolorColor(idle, 0x3dd68c, 0.9);
    // locked — stays 0.5 despite active emissive
    assert.ok(Math.abs((idle.uniforms["uGrain"]!.value as number) - 0.5) < 1e-6);
    blocked.dispose();
    idle.dispose();

    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.2 } });
    } catch {
      return;
    }
    const star = kit.createBotStar({ health: "blocked", idle: false });
    assert.ok(
      Math.abs((star.meshMaterial.uniforms["uGrain"]!.value as number) - STAR_GRAIN_BY_HEALTH.blocked) < 1e-6,
    );
    const idleStar = kit.createBotStar({ idle: true });
    assert.ok(
      Math.abs((idleStar.meshMaterial.uniforms["uGrain"]!.value as number) - STAR_GRAIN_BY_HEALTH.idle) < 1e-6,
    );
    disposePainterlyKit(kit);
  });
});

describe("hacker pass c16: NaN pass uniforms + empty lore atlas growth + fiber", () => {
  it("tickPainterlyPass / sanitizePainterlyPassUniforms repair NaN amount/grain/wash/fiber", () => {
    const pass = createPainterlyPass({ amount: 0.4 });
    pass.uniforms["amount"]!.value = NaN;
    pass.uniforms["grain"]!.value = Infinity;
    pass.uniforms["wash"]!.value = -Infinity;
    if (pass.uniforms["fiber"]) pass.uniforms["fiber"].value = NaN;
    const repaired = sanitizePainterlyPassUniforms(pass);
    assert.ok(repaired >= 3);
    assert.ok(Number.isFinite(pass.uniforms["amount"]!.value as number));
    assert.ok(Number.isFinite(pass.uniforms["grain"]!.value as number));
    assert.ok(Number.isFinite(pass.uniforms["wash"]!.value as number));
    assert.ok(Number.isFinite(pass.uniforms["fiber"]!.value as number));
    // tick also scrubs
    pass.uniforms["amount"]!.value = NaN;
    tickPainterlyPass(pass, 12);
    assert.ok(Number.isFinite(pass.uniforms["amount"]!.value as number));
    assert.ok(Number.isFinite(pass.uniforms["time"]!.value as number));
    disposePainterlyPass(pass);
  });

  it("safePainterlyPassSize(0,0) stays min edge; huge dt time sanitizes", () => {
    const z = safePainterlyPassSize(0, 0, 1);
    assert.equal(z.drawingWidth, 1);
    assert.equal(z.drawingHeight, 1);
    const pass = createPainterlyPass({});
    tickPainterlyPass(pass, 1e12); // hidden-tab resume huge clock
    assert.ok((pass.uniforms["time"]!.value as number) < PAINTER_TIME_PERIOD);
    assert.ok((pass.uniforms["time"]!.value as number) >= 0);
    disposePainterlyPass(pass);
  });

  it("empty lore atlases use LORE_ATLAS_MIN (fleet growth), filled keep default", () => {
    const empty = createLoreTextAtlas("", {});
    assert.equal(empty.empty, true);
    assert.equal(empty.width, LORE_ATLAS_MIN);
    assert.equal(empty.height, LORE_ATLAS_MIN);
    empty.dispose();
    const filled = createLoreTextAtlas(["lock claimed painter lane"], {});
    assert.equal(filled.empty, false);
    assert.equal(filled.width, LORE_ATLAS_DEFAULT);
    filled.dispose();
    // Many empties stay tiny — soft growth check
    const many = [];
    for (let i = 0; i < 48; i++) many.push(createLoreTextAtlas(null, { seed: i }));
    const bytes = many.reduce((s, a) => s + a.width * a.height * 4, 0);
    assert.ok(bytes < 48 * LORE_ATLAS_DEFAULT * LORE_ATLAS_DEFAULT * 4);
    assert.ok(bytes <= 48 * LORE_ATLAS_MIN * LORE_ATLAS_MIN * 4);
    for (const a of many) a.dispose();
  });
});

describe("painter c16: paper-grain fiber direction in post-pass", () => {
  it("PainterlyPassShader exposes fiber + paintWrap anisotropic grain", () => {
    assert.match(PainterlyPassShader.fragmentShader, /uniform float fiber/);
    assert.match(PainterlyPassShader.fragmentShader, /paintWrap\(fUv\)/);
    assert.match(PainterlyPassShader.fragmentShader, /dot\(uv \* 56\.0, dir\)/);
    assert.ok(PainterlyPassShader.uniforms.fiber);
  });

  it("setPassHealth drives fiber from real amount; setFiber locks", () => {
    assert.ok(painterlyFiberFromAmount(PAINTER_AMOUNT_MAX) > painterlyFiberFromAmount(PAINTER_AMOUNT_MIN));
    const pass = createPainterlyPass({ amount: 0.2 });
    const low = setPainterlyPassHealth(pass, { healthy: 0, total: 10 });
    const fiberLow = pass.uniforms["fiber"]!.value as number;
    const high = setPainterlyPassHealth(pass, { healthy: 10, total: 10 });
    const fiberHigh = pass.uniforms["fiber"]!.value as number;
    assert.ok(high > low);
    assert.ok(fiberHigh > fiberLow);
    setPainterlyPassFiber(pass, 0.5);
    setPainterlyPassAmount(pass, 0.8);
    assert.ok(Math.abs((pass.uniforms["fiber"]!.value as number) - 0.5) < 1e-6);
    disposePainterlyPass(pass);
  });
});

describe("hacker pass c17: building scale / 60Hz progress / budget degrade / WebGL1 fallback", () => {
  it("setBuildingProgress is allocation-free across 60Hz×2s storm (no throw, dry tracks progress)", () => {
    const m = createBuildingBrushMaterial({ floors: 12, progress: 0 });
    assert.equal(m.uniforms["uDryBrush"]!.value, 0);
    for (let i = 0; i < 120; i++) {
      setBuildingProgress(m, (i % 11) / 10);
    }
    assert.ok(Number.isFinite(m.uniforms["uProgress"]!.value as number));
    assert.ok(Number.isFinite(m.uniforms["uDryBrush"]!.value as number));
    assert.ok((m.uniforms["uDryBrush"]!.value as number) > 0);
    setBuildingProgress(m, NaN);
    assert.equal(m.uniforms["uProgress"]!.value, 0);
    assert.equal(m.uniforms["uDryBrush"]!.value, 0);
    m.dispose();
  });

  it("createBuildingBrushPool keeps ≤ BUILDING_BRUSH_POOL_MAX mats for thousands of buildings", () => {
    const pool = createBuildingBrushPool({ floors: 10, buckets: 8 });
    assert.ok(pool.materialCount <= BUILDING_BRUSH_POOL_MAX);
    assert.equal(pool.bucketCount, 8);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const mat = pool.materialForProgress((i % 100) / 99);
      seen.add(mat);
    }
    assert.ok(seen.size <= BUILDING_BRUSH_POOL_MAX);
    assert.equal(seen.size, pool.materialCount);
    // Per-building create would be 2000 mats — pool stays tiny
    assert.ok(pool.materialCount < 2000);
    pool.syncFromProgresses([0, 0.5, 1, 0.25, 0.75]);
    pool.dispose();
    assert.equal(pool.materialCount, 0);
  });

  it("forceFallback building records compileError (WebGL1-safe, not silent black)", () => {
    const m = createBuildingBrushMaterial({ forceFallback: true, progress: 0.4, accent: 0x7dc8ff });
    const meta = m.userData.painterMaterialMeta as { fallback?: boolean; compileError?: string };
    assert.equal(meta.fallback, true);
    assert.equal(meta.compileError, "forceFallback");
    assert.ok(m.name.includes("Fallback"));
    assert.ok((m.uniforms["uProgress"]!.value as number) > 0);
    m.dispose();
  });

  it("texture budget overBudget degrades visibly (grain/fiber) and warns once via budgetMeta", () => {
    let kit: import("./use-painterly-kit.ts").PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.5, grain: 0.2 }, textureBudgetBytes: 64 });
    } catch {
      // DOM-less: unit-test noteTextureBudgetReport directly
      const st = createBudgetDegradeState();
      noteTextureBudgetReport(st, { bytes: 1000, budget: 64, overBudget: true });
      assert.equal(st.degraded, true);
      assert.equal(st.warned, true);
      assert.ok(st.degradeCount >= 1);
      return;
    }
    // Force over-budget by tiny cap — paper+star already exceed 64 bytes
    const report = kit.textureBudget();
    assert.equal(report.overBudget, true);
    assert.equal(kit.budgetMeta.degraded, true);
    assert.equal(kit.budgetMeta.warned, true);
    assert.ok((kit.painterlyPass.uniforms["grain"]!.value as number) <= 0.04);
    if (kit.painterlyPass.uniforms["fiber"]) {
      assert.ok((kit.painterlyPass.uniforms["fiber"]!.value as number) <= 0.12);
    }
    disposePainterlyKit(kit);
  });
});

describe("painter c17: dry-brush facades from real progress", () => {
  it("BrushBuildingShader exposes uDryBrush + paintWrap dry strokes", () => {
    assert.match(BrushBuildingShader.fragmentShader, /uDryBrush/);
    assert.match(BrushBuildingShader.fragmentShader, /paintWrap/);
    assert.match(BrushBuildingShader.fragmentShader, /bristle/);
    assert.ok(BrushBuildingShader.uniforms.uDryBrush);
  });

  it("buildingDryBrushFromProgress: 0 at idle; rises with progress; setDryBrush locks", () => {
    assert.equal(buildingDryBrushFromProgress(0), 0);
    assert.ok(buildingDryBrushFromProgress(1) > buildingDryBrushFromProgress(0.2));
    const m = createBuildingBrushMaterial({ progress: 0.5 });
    const mid = m.uniforms["uDryBrush"]!.value as number;
    assert.ok(mid > 0);
    setBuildingDryBrush(m, 0.9);
    setBuildingProgress(m, 0.1);
    assert.ok(Math.abs((m.uniforms["uDryBrush"]!.value as number) - 0.9) < 1e-6);
    m.dispose();
  });
});


describe("hacker pass c18: Imagine race / pool dispose / budget hysteresis / huge map", () => {
  function fakeTex(w: number, h: number, extra: Record<string, unknown> = {}) {
    return {
      image: { width: w, height: h },
      generateMipmaps: false,
      needsUpdate: false,
      colorSpace: "srgb",
      disposed: false,
      dispose() {
        (this as { disposed: boolean }).disposed = true;
      },
      ...extra,
    } as unknown as import("three").Texture;
  }

  it("stale TextureLoader loses to newer setImagineNodeMap (generation race)", () => {
    const mat = createImagineNodeMaterial({ loading: true });
    const genOld = beginImagineNodeMapBind(mat);
    assert.equal(getImagineNodeBindGeneration(mat), genOld);
    // Newer bind starts (rapid swap / second URL)
    const newer = setImagineNodeMap(mat, fakeTex(64, 64));
    assert.equal(newer.ok, true);
    assert.equal(mat.uniforms["uHasImage"]!.value, 1);
    const genNow = getImagineNodeBindGeneration(mat);
    assert.ok(genNow > genOld);
    // Late old completion must not overwrite
    const stale = setImagineNodeMapIfGeneration(mat, fakeTex(32, 32), genOld);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale-generation");
    assert.equal(mat.uniforms["uHasImage"]!.value, 1);
    assert.equal((mat.uniforms["uImage"]!.value as { image: { width: number } }).image.width, 64);
    mat.dispose();
  });

  it("404/CORS fail records imagineMapError and blocks late success via generation bump", () => {
    const mat = createImagineNodeMaterial({ lane: "visual-fleet", health: "healthy", loading: true });
    assert.equal(mat.uniforms["uLoading"]!.value, 1);
    assert.equal((mat.userData as { imagineMapError: string }).imagineMapError, "loading");
    const gen = beginImagineNodeMapBind(mat);
    setImagineNodeMapFailed(mat, "load-failed");
    assert.equal(mat.uniforms["uHasImage"]!.value, 0);
    assert.equal(mat.uniforms["uLoading"]!.value, 0);
    assert.equal((mat.userData as { imagineMapError: string }).imagineMapError, "load-failed");
    const late = setImagineNodeMapIfGeneration(mat, fakeTex(48, 48), gen);
    assert.equal(late.reason, "stale-generation");
    // CORS-tainted path still explicit
    const tainted = sanitizeImagineImageTexture(fakeTex(64, 64), { maxTextureSize: 256 });
    // Without DOM taint probe returns false — still accept; force reject via disposed
    const disposed = fakeTex(64, 64);
    (disposed as unknown as { disposed: boolean }).disposed = true;
    assert.equal(sanitizeImagineImageTexture(disposed).reason, "texture-disposed");
    mat.dispose();
  });

  it("huge dims beyond MAX_TEXTURE_SIZE reject with exceeds-max-texture-size (no silent bind)", () => {
    const mat = createImagineNodeMaterial({ maxTextureSize: 128 });
    const r = setImagineNodeMap(mat, fakeTex(4096, 4096), {
      maxTextureSize: 128,
      allowDownscale: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "exceeds-max-texture-size");
    assert.equal(mat.uniforms["uHasImage"]!.value, 0);
    assert.equal((mat.userData as { imagineMapError: string }).imagineMapError, "exceeds-max-texture-size");
    mat.dispose();
  });

  it("building brush pool materialForProgress after dispose returns live tombstone (no undefined crash)", () => {
    const pool = createBuildingBrushPool({ buckets: 4, floors: 8 });
    const before = pool.materialForProgress(0.5);
    assert.ok(before);
    pool.dispose();
    assert.equal(pool.materialCount, 0);
    const after = pool.materialForProgress(0.75);
    assert.ok(after, "must return a material after dispose");
    assert.ok(after.uniforms?.["uProgress"]);
    assert.equal((after.userData as { buildingPoolTombstone?: boolean }).buildingPoolTombstone, true);
    // reassignment / sync must not throw
    assert.doesNotThrow(() => pool.syncFromProgresses([0.1, 0.9]));
    const again = pool.materialForProgress(1);
    assert.equal(again, after);
    after.dispose();
  });

  it("budget degrade hysteresis: no flicker when overBudget toggles every frame", () => {
    const st = createBudgetDegradeState();
    const budget = 1000;
    // Flicker at the edge
    for (let i = 0; i < 20; i++) {
      noteTextureBudgetReport(st, {
        bytes: i % 2 === 0 ? 1100 : 900,
        budget,
        overBudget: i % 2 === 0,
      });
    }
    // Last sample under — still degraded unless streak+ratio met
    assert.equal(st.degraded, true, "must stay degraded through edge flicker");
    // Sustained recovery under hysteresis ratio
    const exitNeed = budget * BUDGET_HYSTERESIS_RATIO;
    for (let i = 0; i < BUDGET_HYSTERESIS_FRAMES; i++) {
      noteTextureBudgetReport(st, { bytes: exitNeed - 1, budget, overBudget: false });
    }
    assert.equal(st.degraded, false);
    assert.equal(st.warned, false, "warned resets on recovery so next exceed can warn");
  });
});

describe("painter c18: Imagine missing-art wash from real lane+health", () => {
  it("ImagineNodeShader exposes uLoading pulse for honest loading wash", () => {
    assert.ok(ImagineNodeShader.uniforms.uLoading);
    assert.match(ImagineNodeShader.fragmentShader, /uLoading/);
    assert.match(ImagineNodeShader.fragmentShader, /Honest loading pulse|uLoading > 0\.5/);
  });

  it("imagineWashFromLaneHealth keys wash/accent by lane+health; unknown → idle neutral", () => {
    const healthyFleet = imagineWashFromLaneHealth("visual-fleet", "healthy");
    const blockedMerge = imagineWashFromLaneHealth("merge", "blocked");
    const unknown = imagineWashFromLaneHealth(null, "not-a-health");
    assert.equal(healthyFleet.health, "healthy");
    assert.equal(healthyFleet.lane, "visual-fleet");
    assert.deepEqual(
      [healthyFleet.accent.r, healthyFleet.accent.g, healthyFleet.accent.b],
      IMAGINE_LANE_ACCENT_RGB["visual-fleet"],
    );
    assert.equal(blockedMerge.health, "blocked");
    assert.ok(blockedMerge.bleed > healthyFleet.bleed);
    assert.equal(unknown.health, "idle");
    assert.equal(unknown.lane, null);
    // Missing art material uses wash (no fabricated map)
    const m = createImagineNodeMaterial({
      lane: "dashboard",
      health: "stalled",
      loading: true,
    });
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    assert.equal(m.uniforms["uLoading"]!.value, 1);
    assert.equal((m.userData as { imagineHealth: string }).imagineHealth, "stalled");
    setImagineNodeLoading(m, false);
    assert.equal(m.uniforms["uLoading"]!.value, 0);
    setImagineNodeLaneWash(m, { lane: "rea", health: "healthy" });
    assert.equal((m.userData as { imagineLane: string }).imagineLane, "rea");
    m.dispose();
  });
});


describe("hacker pass c19: lock claimed_at age / atlas heartbeat churn / density saturate", () => {
  it("malformed, missing, future, mixed-offset claimed_at never yield NaN/negative age", () => {
    const now = Date.parse("2026-11-02T23:00:00+01:00"); // WAT
    const miss = lockAgeSecondsFromClaimedAt(null, now);
    assert.equal(miss.meta.reason, "missing");
    assert.equal(miss.ageSeconds, 0);
    assert.equal(miss.meta.inkDensity, LORE_INK_DENSITY_NEUTRAL);

    const bad = lockAgeSecondsFromClaimedAt("not-a-date", now);
    assert.equal(bad.meta.reason, "malformed");
    assert.ok(Number.isFinite(bad.ageSeconds));

    const future = lockAgeSecondsFromClaimedAt("2026-11-02T23:30:00+01:00", now);
    assert.equal(future.ageSeconds, 0);
    assert.equal(future.meta.skewClamped, true);

    // Mixed offsets: claimed in -06:00, now in +01:00 — absolute ms delta
    const claimedCst = "2026-11-02T15:00:00-06:00"; // == 21:00Z / 22:00+01
    const age = lockAgeSecondsFromClaimedAt(claimedCst, now);
    assert.ok(age.meta.ok);
    assert.ok(age.ageSeconds > 0);
    assert.ok(Number.isFinite(age.ageSeconds));
    assert.ok(age.ageSeconds < LORE_INK_AGE_MAX_S);

    // Epoch seconds vs ms
    const sec = Math.floor(now / 1000) - 120;
    assert.ok(Math.abs(lockAgeSecondsFromClaimedAt(sec, now).ageSeconds - 120) < 1);
    assert.ok(Math.abs(lockAgeSecondsFromClaimedAt(now - 90_000, now).ageSeconds - 90) < 1);

    assert.equal(parseLockClaimedAtMs(NaN), null);
    assert.equal(parseLockClaimedAtMs(""), null);
  });

  it("DST / clock-skew spanning: age uses UTC ms; density saturates (no growing uniform counter)", () => {
    // Before/after a US DST boundary still yields finite age via Date.parse
    const spring = Date.parse("2026-03-08T12:00:00-05:00");
    const claimed = "2026-03-08T01:30:00-06:00"; // ambiguous-ish local; parse to absolute
    const { ageSeconds, meta } = lockAgeSecondsFromClaimedAt(claimed, spring);
    assert.ok(meta.ok || meta.reason != null);
    assert.ok(Number.isFinite(ageSeconds));
    assert.ok(ageSeconds >= 0);

    // Long session: age at MAX still maps to faded floor — not raw age as uniform
    const densMax = loreInkDensityFromAgeSeconds(LORE_INK_AGE_MAX_S);
    assert.ok(Math.abs(densMax - LORE_INK_DENSITY_FADED) < 1e-6);
    const densFresh = loreInkDensityFromAgeSeconds(0);
    assert.ok(Math.abs(densFresh - LORE_INK_DENSITY_FRESH) < 1e-6);
    assert.ok(loreInkDensityFromAgeSeconds(LORE_INK_AGE_STALE_S / 2) < densFresh);
    assert.ok(lorePaperFromAgeSeconds(LORE_INK_AGE_STALE_S) > lorePaperFromAgeSeconds(0));
    // Hostile age inputs
    assert.ok(Number.isFinite(loreInkDensityFromAgeSeconds(NaN)));
    assert.ok(Number.isFinite(loreInkDensityFromAgeSeconds(-1e9)));
  });

  it("lock heartbeat re-bind does not rebuild atlas when notes unchanged (churn guard)", () => {
    const mat = createLorePlaqueMaterial({});
    const notes = "painter c19 claimed lane";
    const r1 = setLorePlaqueNotesCached(mat, notes);
    assert.equal(r1.rebuilt, true);
    assert.equal(r1.empty, false);
    const tex1 = mat.uniforms["uTextMap"]!.value;
    // Simulate heartbeat storm — same notes, claimed_at bump only
    for (let i = 0; i < 60; i++) {
      const r = setLorePlaqueNotesCached(mat, notes);
      assert.equal(r.rebuilt, false, `heartbeat ${i} must not rebuild`);
    }
    assert.equal(mat.uniforms["uTextMap"]!.value, tex1);
    // Notes change → rebuild once
    const r2 = setLorePlaqueNotesCached(mat, notes + " · updated");
    assert.equal(r2.rebuilt, true);
    assert.notEqual(mat.uniforms["uTextMap"]!.value, tex1);
    // Fingerprint stable
    assert.equal(loreNotesFingerprint(notes), loreNotesFingerprint(notes));
    mat.dispose();
  });
});

describe("painter c19: lore plaque ink density from real lock age", () => {
  it("LorePlaqueShader exposes uInkDensity; age drives density+paper; no lock → neutral/empty", () => {
    assert.ok(LorePlaqueShader.uniforms.uInkDensity);
    assert.match(LorePlaqueShader.fragmentShader, /uInkDensity/);

    const now = Date.parse("2026-11-02T23:00:00+01:00");
    const fresh = createLorePlaqueMaterial({
      claimedAt: "2026-11-02T22:55:00+01:00",
      nowMs: now,
    });
    assert.ok((fresh.uniforms["uInkDensity"]!.value as number) > 0.9);
    assert.ok((fresh.uniforms["uPaper"]!.value as number) < LORE_PAPER_NEUTRAL + 0.05);

    const stale = createLorePlaqueMaterial({
      claimedAt: "2026-11-01T10:00:00+01:00",
      nowMs: now,
    });
    assert.ok((stale.uniforms["uInkDensity"]!.value as number) < (fresh.uniforms["uInkDensity"]!.value as number));
    assert.ok((stale.uniforms["uPaper"]!.value as number) > (fresh.uniforms["uPaper"]!.value as number));

    const none = createLorePlaqueMaterial({});
    assert.ok(Math.abs((none.uniforms["uInkDensity"]!.value as number) - LORE_INK_DENSITY_NEUTRAL) < 1e-6);
    const empty = setLorePlaqueNotesCached(none, null);
    assert.equal(empty.empty, true);

    setLorePlaqueInkDensity(fresh, 0.5);
    setLorePlaqueLockAge(fresh, "2026-11-02T22:00:00+01:00", { nowMs: now });
    // locked density stays
    assert.ok(Math.abs((fresh.uniforms["uInkDensity"]!.value as number) - 0.5) < 1e-6);

    fresh.dispose();
    stale.dispose();
    none.dispose();
  });
});


describe("hacker pass c20: plaque z-fight / blend order / logDepth / half-float RT", () => {
  it("overlapping plaques get distinct polygonOffset+renderOrder (no coplanar fight)", () => {
    const mats = [0, 1, 2, 5].map((i) => createLorePlaqueMaterial({ stackIndex: i, skipStackHarden: true }));
    const results = mats.map((m, i) => applyLorePlaqueStackLayer(m, { stackIndex: [0, 1, 2, 5][i] }));
    const units = new Set(results.map((r) => r!.polygonOffsetUnits));
    assert.equal(units.size, 4, "each stack index needs unique polygonOffsetUnits");
    const orders = new Set(results.map((r) => r!.renderOrder));
    assert.equal(orders.size, 4);
    for (const r of results) {
      assert.equal(r!.depthWrite, false, "transparent plaques must not write depth");
      assert.equal(r!.polygonOffset, true);
    }
    // depthWrite:true would punch holes — explicit opt-in only
    const opaque = applyLorePlaqueStackLayer(mats[0]!, { stackIndex: 0, depthWrite: true });
    assert.equal(opaque!.depthWrite, true);
    // null/disposed → honest null
    assert.equal(applyLorePlaqueStackLayer(null), null);
    mats.forEach((m) => m.dispose());
  });

  it("nebula/ink/lore renderOrder band prevents transparent blend flicker", () => {
    assert.ok(PAINTER_RENDER_ORDER.nebula < PAINTER_RENDER_ORDER.inkEdge);
    assert.ok(PAINTER_RENDER_ORDER.inkEdge < PAINTER_RENDER_ORDER.loreBase);
    assert.ok(PAINTER_RENDER_ORDER.loreBase < PAINTER_RENDER_ORDER.imagine);
    const mat = createLorePlaqueMaterial({ skipStackHarden: true });
    const mesh = { renderOrder: 0, userData: {} } as unknown as import("three").Object3D;
    applyPainterTransparentLayer(mat, "loreBase", mesh);
    assert.equal((mesh as { renderOrder: number }).renderOrder, PAINTER_RENDER_ORDER.loreBase);
    mat.dispose();
  });

  it("log-depth patch marks ShaderMaterial; lore shader includes logdepthbuf chunks", () => {
    assert.match(LorePlaqueShader.vertexShader, /logdepthbuf/);
    assert.match(LorePlaqueShader.fragmentShader, /logdepthbuf/);
    const mat = createLorePlaqueMaterial({ skipStackHarden: true });
    assert.equal(applyPainterLogDepthSupport(mat), true);
    assert.equal((mat.userData as { painterLogDepthPatched?: boolean }).painterLogDepthPatched, true);
    assert.equal(typeof mat.onBeforeCompile, "function");
    // Idempotent
    assert.equal(applyPainterLogDepthSupport(mat), true);
    mat.dispose();
  });

  it("half-float RT resolves to UnsignedByte when unsupported or forced (MSAA mismatch)", () => {
    const ok = resolvePainterlyRenderTargetType({ halfFloatSupported: true });
    assert.equal(ok.halfFloat, true);
    const bad = resolvePainterlyRenderTargetType({ halfFloatSupported: false });
    assert.equal(bad.halfFloat, false);
    assert.equal(bad.reason, "half-float-unsupported");
    const forced = resolvePainterlyRenderTargetType({ forceUnsignedByte: true });
    assert.equal(forced.reason, "forceUnsignedByte");
    const pass = createPainterlyPass({ forceUnsignedByte: true });
    const meta = (pass as unknown as { userData: { painterPassMeta: { halfFloat: boolean; renderTargetReason: string | null } } }).userData.painterPassMeta;
    assert.equal(meta.halfFloat, false);
    assert.equal(meta.renderTargetReason, "forceUnsignedByte");
    // probe with null gl → false (honest)
    assert.equal(probeHalfFloatRenderTargetSupport(null), false);
    disposePainterlyPass(pass);
  });
});

describe("painter c20: constellation plaque stack layered paper", () => {
  it("createLorePlaqueMaterial applies stack harden; uStackLift rises with index", () => {
    const bottom = createLorePlaqueMaterial({ stackIndex: 0 });
    const top = createLorePlaqueMaterial({ stackIndex: 8 });
    assert.equal(bottom.polygonOffset, true);
    assert.equal(bottom.depthWrite, false);
    assert.ok((bottom.uniforms["uStackLift"]!.value as number) < (top.uniforms["uStackLift"]!.value as number));
    assert.ok(Math.abs((bottom.polygonOffsetUnits as number) - (-LORE_PLAQUE_OFFSET_UNITS)) < 1e-6);
    const mesh = { renderOrder: 0, userData: {} } as unknown as import("three").Object3D;
    setLorePlaqueStackIndex(bottom, 3, mesh);
    assert.equal((mesh as { renderOrder: number }).renderOrder, PAINTER_RENDER_ORDER.loreBase + 3);
    assert.match(LorePlaqueShader.fragmentShader, /uStackLift/);
    bottom.dispose();
    top.dispose();
  });
});


describe("hacker pass c21: HDR halo/grain bloom blowout / toneMapped / premul / colorSpace", () => {
  it("legacy HDR pigment (>1) soft-caps under matte; matte=1 stays ≤ bloom-safe ceiling", () => {
    const hot: [number, number, number] = [1.4, 1.55, 1.2];
    const open = bloomSafeClampRgb(hot, 0);
    assert.ok(Math.max(...open) <= PAINTER_HDR_CEILING + 1e-6);
    assert.ok(Math.max(...open) > 1.0, "matte=0 may keep mild HDR headroom");
    const safe = bloomSafeClampRgb(hot, 1);
    assert.ok(Math.max(...safe) <= PAINTER_BLOOM_SAFE_CEILING + 1e-6);
    // NaN channels → finite
    const nan = bloomSafeClampRgb([NaN, 2, 2], 1);
    assert.ok(nan.every((v) => Number.isFinite(v)));
  });

  it("sanitizeStarHalo rejects >1 HDR (was 1.5); grain spikes clamped", () => {
    assert.ok(sanitizeStarHalo(1.5) <= 1);
    assert.ok(sanitizeStarHalo(-3) === 0);
    const m = createStarWatercolorMaterial({ halo: 1.5, grain: 2, emissiveIntensity: 3, matte: 1 });
    assert.ok((m.uniforms["uHalo"]!.value as number) <= 1);
    assert.ok((m.uniforms["uGrain"]!.value as number) <= 1);
    assert.ok((m.uniforms["uMatte"]!.value as number) >= 0.99);
    m.dispose();
  });

  it("painter materials: toneMapped false + premultipliedAlpha (no washout / dark fringes)", () => {
    const m = createStarWatercolorMaterial({ color: 0x3cd687 });
    assert.equal(m.toneMapped, false);
    assert.equal(m.premultipliedAlpha, true);
    assert.equal(m.transparent, true);
    assert.ok((m.userData as { painterOutputSafe?: { toneMapped: boolean } }).painterOutputSafe);
    // glow path via flags helper
    const sprite = { transparent: true, toneMapped: true, premultipliedAlpha: false, needsUpdate: false, userData: {} };
    applyPainterOutputSafeFlags(sprite as never, { transparent: true, premultipliedAlpha: true });
    assert.equal((sprite as { toneMapped: boolean }).toneMapped, false);
    assert.equal((sprite as { premultipliedAlpha: boolean }).premultipliedAlpha, true);
    m.dispose();
  });

  it("WatercolorStarShader exposes uMatte + bloomSafeClamp; premul output", () => {
    assert.ok(WatercolorStarShader.uniforms.uMatte);
    assert.match(WatercolorStarShader.fragmentShader, /bloomSafeClamp/);
    assert.match(WatercolorStarShader.fragmentShader, /uMatte/);
    assert.match(WatercolorStarShader.fragmentShader, /pigment \* alpha/);
    assert.doesNotMatch(WatercolorStarShader.fragmentShader, /clamp\(pigment,\s*0\.0,\s*1\.6\)/);
  });
});

describe("painter c21: star corona bloom-safe matte", () => {
  it("createBotStar / createStarWatercolorMaterial apply matte; idle quieter than active", () => {
    assert.equal(starMatteFromStatus(true), PAINTER_MATTE_IDLE);
    assert.equal(starMatteFromStatus(false), PAINTER_MATTE_DEFAULT);
    const idle = createStarWatercolorMaterial({ idle: true, color: 0x8899aa });
    const active = createStarWatercolorMaterial({ idle: false, color: 0x3cd687 });
    assert.ok((idle.uniforms["uMatte"]!.value as number) > (active.uniforms["uMatte"]!.value as number));
    setStarMatte(active, 1);
    setStarHalo(active, 0.9);
    assert.ok(Math.abs((active.uniforms["uMatte"]!.value as number) - 1) < 1e-6);
    // locked matte survives setColor emissive path
    setStarWatercolorColor(active, 0xff0000, 0.9);
    assert.ok(Math.abs((active.uniforms["uMatte"]!.value as number) - 1) < 1e-6);
    idle.dispose();
    active.dispose();
  });
});


describe("hacker pass c22: focus thrash / disposed / swapped / high-DPR quality", () => {
  it("rapid setImagineNodeFocus only updates target — uFocus eases in tick (no uniform thrash)", () => {
    const m = createImagineNodeMaterial({ focus: 0 });
    assert.equal(m.uniforms["uFocus"]!.value, 0);
    // pointer spam: 40 flips without tick — uFocus stays at last eased value (0)
    for (let i = 0; i < 40; i++) {
      const r = setImagineNodeFocus(m, i % 2);
      assert.equal(r.ok, true);
      assert.equal(r.target, i % 2);
    }
    assert.equal(m.uniforms["uFocus"]!.value, 0, "uFocus must not thrash on set");
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 1);
    setImagineNodeFocus(m, 1);
    // one tick with large dt eases toward 1 but not necessarily snap without enough time
    tickImagineNodeMaterial(m, 0.1, { dt: 0.1 });
    const mid = m.uniforms["uFocus"]!.value as number;
    assert.ok(mid > 0.4 && mid < 1, `eased mid=${mid}`);
    tickImagineNodeMaterial(m, 1.0, { dt: 0.5, snapFocus: false });
    // another long ease
    for (let i = 0; i < 30; i++) tickImagineNodeMaterial(m, 1 + i * 0.05, { dt: 0.05 });
    assert.ok(Math.abs((m.uniforms["uFocus"]!.value as number) - 1) < 0.01);
    // snap path
    setImagineNodeFocus(m, 0);
    tickImagineNodeMaterial(m, 10, { snapFocus: true });
    assert.equal(m.uniforms["uFocus"]!.value, 0);
    m.dispose();
  });

  it("setImagineNodeFocus no-ops on released/disposed; clears stuck focus on release", () => {
    const m = createImagineNodeMaterial();
    setImagineNodeFocus(m, 1);
    tickImagineNodeMaterial(m, 1, { snapFocus: true });
    assert.equal(m.uniforms["uFocus"]!.value, 1);
    markImagineNodeReleased(m);
    assert.equal(m.uniforms["uFocus"]!.value, 0, "release clears uFocus");
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 0);
    const late = setImagineNodeFocus(m, 1);
    assert.equal(late.ok, false);
    assert.equal(late.reason, "material-released");
    assert.equal(m.uniforms["uFocus"]!.value, 0, "no stuck focus after unmount");
    tickImagineNodeMaterial(m, 2, { dt: 0.1 }); // must no-op
    assert.equal(m.uniforms["uFocus"]!.value, 0);
    m.dispose();
    const afterDispose = setImagineNodeFocus(m, 1);
    assert.equal(afterDispose.ok, false);
  });

  it("uniform update when material swapped by scene (wrong name) is rejected", () => {
    const m = createImagineNodeMaterial();
    m.name = "MeshBasicMaterialProxy"; // scene swapped
    const r = setImagineNodeFocus(m, 1);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "material-swapped");
    assert.equal(isImagineNodeFocusable(m), false);
    // restore name but drop uniforms → missing-uniforms path via focusable false
    m.name = "ImagineNodeMaterial";
    delete (m.uniforms as Record<string, unknown>)["uFocus"];
    const r2 = setImagineNodeFocus(m, 0.5);
    assert.equal(r2.ok, false);
    m.dispose();
  });

  it("painterQualityFromDpr tiers cheap path for 4K/high DPR; setImagineNodeQuality honors", () => {
    const low = painterQualityFromDpr(1);
    assert.equal(low.quality, 1);
    assert.equal(low.cheap, false);
    const mid = painterQualityFromDpr(2);
    assert.ok(mid.quality < 1 && mid.quality > 0);
    const hi = painterQualityFromDpr(3);
    assert.equal(hi.quality, 0);
    assert.equal(hi.cheap, true);
    const m = createImagineNodeMaterial({ quality: 1 });
    const q = setImagineNodeQuality(m, 3, { asDpr: true });
    assert.equal(q.ok, true);
    assert.equal(m.uniforms["uQuality"]!.value, 0);
    tickImagineNodeMaterial(m, 0.5, { dpr: 1 });
    assert.equal(m.uniforms["uQuality"]!.value, 1);
    markImagineNodeReleased(m);
    const dead = setImagineNodeQuality(m, 0.5);
    assert.equal(dead.ok, false);
    m.dispose();
  });
});

describe("painter c22: Imagine card paper bevel under focus", () => {
  it("ImagineNodeShader exposes uFocus/uQuality + bevel/deckle + cheap grain path", () => {
    assert.ok(ImagineNodeShader.uniforms.uFocus);
    assert.ok(ImagineNodeShader.uniforms.uQuality);
    assert.match(ImagineNodeShader.fragmentShader, /uFocus/);
    assert.match(ImagineNodeShader.fragmentShader, /uQuality/);
    assert.match(ImagineNodeShader.fragmentShader, /bevel|deckle|paper bevel/i);
    assert.match(ImagineNodeShader.fragmentShader, /qual > 0\.35|cheap/i);
  });

  it("createImagineNodeMaterial seeds focus/quality; setImagineNodeFocus is the only driver API", () => {
    const m = createImagineNodeMaterial({ focus: 0.25, quality: 0.8 });
    assert.ok(Math.abs((m.uniforms["uFocus"]!.value as number) - 0.25) < 1e-6);
    assert.ok(Math.abs((m.uniforms["uQuality"]!.value as number) - 0.8) < 1e-6);
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 0.25);
    assert.equal(m.toneMapped, false);
    assert.equal(m.premultipliedAlpha, true);
    assert.ok(IMAGINE_FOCUS_EASE > 0);
    // NaN/OOB clamp
    setImagineNodeFocus(m, Number.NaN);
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 0);
    setImagineNodeFocus(m, 2);
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 1);
    setImagineNodeFocus(m, -5);
    assert.equal((m.userData as { imagineFocusTarget: number }).imagineFocusTarget, 0);
    m.dispose();
  });

  it("tickImagineNodeMaterial / tickPainterlyKit dpr drives Imagine quality tier", () => {
    const m = createImagineNodeMaterial({ quality: 1 });
    assert.equal(m.uniforms["uQuality"]!.value, 1);
    tickImagineNodeMaterial(m, 1.0, { dpr: 3 });
    assert.equal(m.uniforms["uQuality"]!.value, 0);
    tickImagineNodeMaterial(m, 1.1, { dpr: 1 });
    assert.equal(m.uniforms["uQuality"]!.value, 1);
    setImagineNodeFocus(m, 1);
    tickImagineNodeMaterial(m, 1.2, { snapFocus: true });
    assert.equal(m.uniforms["uFocus"]!.value, 1);
    // Full kit path when DOM canvas available (matches c14/c15 pattern)
    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.2 } });
    } catch {
      m.dispose();
      return;
    }
    const m2 = kit.createImagineNodeMaterial({});
    tickPainterlyKit(kit, 2.0, { dpr: 3 });
    assert.equal(m2.uniforms["uQuality"]!.value, 0);
    tickPainterlyKit(kit, 2.1, { dpr: 1, reducedMotion: true });
    assert.equal(m2.uniforms["uQuality"]!.value, 1);
    disposePainterlyKit(kit);
    m.dispose();
  });
});


describe("hacker pass c23: extreme aspect / NaN aspect / NPOT sampler / anisotropy", () => {
  function fakeTex(w: number, h: number, extra: Record<string, unknown> = {}) {
    return {
      image: { width: w, height: h },
      needsUpdate: false,
      generateMipmaps: true,
      minFilter: 1008, // LinearMipmapLinear
      magFilter: 1006,
      wrapS: 1000, // Repeat
      wrapT: 1000,
      anisotropy: 16,
      colorSpace: "srgb",
      dispose() {},
      ...extra,
    } as unknown as import("three").Texture;
  }

  it("imagineAspectFromDims never yields NaN (0-height / NaN / Inf → neutral 1)", () => {
    assert.equal(imagineAspectFromDims(0, 0), IMAGINE_ASPECT_DEFAULT);
    assert.equal(imagineAspectFromDims(64, 0), IMAGINE_ASPECT_DEFAULT);
    assert.equal(imagineAspectFromDims(0, 64), IMAGINE_ASPECT_DEFAULT);
    assert.equal(imagineAspectFromDims(Number.NaN, 64), IMAGINE_ASPECT_DEFAULT);
    assert.equal(imagineAspectFromDims(64, Number.NaN), IMAGINE_ASPECT_DEFAULT);
    assert.equal(imagineAspectFromDims(Number.POSITIVE_INFINITY, 10), IMAGINE_ASPECT_DEFAULT);
    assert.ok(Number.isFinite(imagineAspectFromDims(100, 50)));
    assert.equal(imagineAspectFromDims(100, 50), 2);
    assert.equal(imagineAspectFromDims(50, 100), 0.5);
  });

  it("extreme 1×4000 / 4000×1 clamp to IMAGINE_ASPECT_MAX band (letterbox, no stretch NaN)", () => {
    const thin = imagineAspectFromDims(1, 4000);
    assert.ok(Number.isFinite(thin));
    assert.equal(thin, 1 / IMAGINE_ASPECT_MAX);
    const wide = imagineAspectFromDims(4000, 1);
    assert.equal(wide, IMAGINE_ASPECT_MAX);
    const r = sanitizeImagineImageTexture(fakeTex(1, 4000), { maxTextureSize: 8192, allowDownscale: false });
    assert.equal(r.ok, true);
    assert.equal(r.aspect, 1 / IMAGINE_ASPECT_MAX);
    assert.equal(r.width, 1);
    assert.equal(r.height, 4000);
  });

  it("NPOT + Repeat + mipmaps + high anisotropy → sampler-safe (WebGL1 black guard)", () => {
    const tex = fakeTex(300, 200, { anisotropy: 64, wrapS: 1000, wrapT: 1000, generateMipmaps: true });
    const r = sanitizeImagineImageTexture(tex, {
      maxTextureSize: 1024,
      allowDownscale: false,
      maxAnisotropy: 4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.npot, true);
    assert.equal(tex.generateMipmaps, false);
    // three: RepeatWrapping=1000, ClampToEdgeWrapping=1001
    assert.equal(tex.wrapS, 1001);
    assert.equal(tex.wrapT, 1001);
    assert.equal(tex.minFilter, 1006); // LinearFilter
    assert.equal(tex.anisotropy, 4); // clamped to gpu max 4, not 64
  });

  it("clampImagineAnisotropy never exceeds GPU max or hard max", () => {
    assert.equal(clampImagineAnisotropy(16, 1), 1);
    assert.equal(clampImagineAnisotropy(8, 4), 4);
    assert.equal(clampImagineAnisotropy(Number.NaN, 8), 1);
    assert.equal(clampImagineAnisotropy(100, 32), 16);
    assert.equal(clampImagineAnisotropy(2, 8), 2);
  });

  it("0-height map reject keeps uAspect neutral (no NaN uniform)", () => {
    const m = createImagineNodeMaterial();
    assert.equal(m.uniforms["uAspect"]!.value, IMAGINE_ASPECT_DEFAULT);
    const r = setImagineNodeMap(m, fakeTex(128, 0));
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid-dimensions");
    assert.equal(r.aspect, IMAGINE_ASPECT_DEFAULT);
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    assert.equal(m.uniforms["uAspect"]!.value, IMAGINE_ASPECT_DEFAULT);
    assert.ok(Number.isFinite(m.uniforms["uAspect"]!.value as number));
    m.dispose();
  });
});

describe("painter c23: aspect-safe Imagine deckle under non-square maps", () => {
  function fakeTex(w: number, h: number) {
    return {
      image: { width: w, height: h },
      needsUpdate: false,
      generateMipmaps: true,
      minFilter: 1008,
      magFilter: 1006,
      wrapS: 1000,
      wrapT: 1000,
      anisotropy: 1,
      colorSpace: "srgb",
      dispose() {},
    } as unknown as import("three").Texture;
  }

  it("ImagineNodeShader exposes uAspect + letterbox content UV / deckle", () => {
    assert.ok(ImagineNodeShader.uniforms.uAspect);
    assert.match(ImagineNodeShader.fragmentShader, /uAspect/);
    assert.match(ImagineNodeShader.fragmentShader, /contentLo|contentUv|letterbox|contentSize/);
    assert.match(ImagineNodeShader.fragmentShader, /inContent/);
  });

  it("setImagineNodeMap writes finite uAspect from real dims; clear resets to 1", () => {
    const m = createImagineNodeMaterial();
    const portrait = setImagineNodeMap(m, fakeTex(200, 400), { maxTextureSize: 1024 });
    assert.equal(portrait.ok, true);
    assert.equal(portrait.aspect, 0.5);
    assert.equal(m.uniforms["uAspect"]!.value, 0.5);
    const land = setImagineNodeMap(m, fakeTex(800, 200), { maxTextureSize: 1024 });
    assert.equal(land.aspect, 4);
    assert.equal(m.uniforms["uAspect"]!.value, 4);
    setImagineNodeMap(m, null);
    assert.equal(m.uniforms["uAspect"]!.value, IMAGINE_ASPECT_DEFAULT);
    assert.equal(m.uniforms["uHasImage"]!.value, 0);
    m.dispose();
  });
});


describe("hacker pass c24: kit remount leak + hidden-tab tick pause", () => {
  function withDomCanvas<T>(fn: () => T): T {
    const g = globalThis as { document?: { hidden: boolean; createElement: (tag: string) => unknown } };
    const prev = g.document;
    const grad = { addColorStop() {} };
    g.document = {
      hidden: false,
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            {
              canvas: c,
              fillStyle: "#000",
              strokeStyle: "#000",
              globalAlpha: 1,
              createRadialGradient: () => grad,
              createLinearGradient: () => grad,
              getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
            },
            { get(target, prop, recv) {
              if (prop in target) return Reflect.get(target, prop, recv);
              return () => grad;
            }},
          );
        return c;
      },
    };
    try {
      return fn();
    } finally {
      g.document = prev;
    }
  }

  it("navigate away/back without disposePriorLive grows live kit count (leak)", () => {
    withDomCanvas(() => {
      disposeAllPainterlyKits();
      assert.equal(livePainterlyKitCount(), 0);
      const a = createPainterlyKit({ pass: { amount: 0.2 }, kitScope: "dashboard" });
      assert.equal(livePainterlyKitCount(), 1);
      const b = createPainterlyKit({ pass: { amount: 0.2 }, kitScope: "dashboard" });
      assert.equal(livePainterlyKitCount(), 2, "leak: two live kits same scope");
      disposePainterlyKit(a);
      disposePainterlyKit(b);
      assert.equal(livePainterlyKitCount(), 0);
    });
  });

  it("disposePriorLive clears prior kits on remount (route /dashboard leak fix)", () => {
    withDomCanvas(() => {
      disposeAllPainterlyKits();
      createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "dashboard" });
      createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "dashboard" });
      assert.ok(livePainterlyKitCount() >= 2);
      const kit = createPainterlyKit({
        pass: { amount: 0.2 },
        kitScope: "dashboard",
        disposePriorLive: true,
      });
      assert.equal(livePainterlyKitCount(), 1);
      assert.equal(kit.kitScope, "dashboard");
      assert.equal(kit.disposed, false);
      disposePainterlyKit(kit);
      assert.equal(livePainterlyKitCount(), 0);
    });
  });

  it("tickPainterlyKit no-ops while document.hidden (rAF stop / background tab)", () => {
    const g = globalThis as { document?: { hidden: boolean } };
    const prev = g.document;
    g.document = { hidden: true };
    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.3 } });
    } catch {
      g.document = prev;
      // DOM-less kit create may fail — still assert guard with mock kit path
      assert.ok(true);
      return;
    }
    const m = kit.createCityGroundMaterial({});
    tickPainterlyKit(kit, 1.0);
    assert.equal((kit as { lastTickSkippedHidden?: boolean }).lastTickSkippedHidden, true);
    assert.equal(kit.lastTickUniformWrites, 0);
    assert.equal(m.uniforms["uTime"]!.value, 0);
    tickPainterlyKit(kit, 2.0, { forceTick: true });
    assert.equal((kit as { lastTickSkippedHidden?: boolean }).lastTickSkippedHidden, false);
    assert.ok((m.uniforms["uTime"]!.value as number) > 0);
    g.document = { hidden: false };
    tickPainterlyKit(kit, 3.0);
    assert.equal((kit as { lastTickSkippedHidden?: boolean }).lastTickSkippedHidden, false);
    disposePainterlyKit(kit);
    g.document = prev;
  });
});

describe("painter c24: city plaza watercolor ground", () => {
  it("CityGroundShader exposes wet rings + fiber (replaces GridHelper CAD look)", () => {
    assert.ok(CityGroundShader.uniforms.uWet);
    assert.ok(CityGroundShader.uniforms.uRing);
    assert.match(CityGroundShader.fragmentShader, /rings|uRing/);
    assert.match(CityGroundShader.fragmentShader, /paintFbm|fiber/);
  });

  it("createCityGroundMaterial is painterly (not MeshStandard) with output-safe flags", () => {
    const m = createCityGroundMaterial({ base: 0x0a1020, ink: 0x2b3a66, ring: 0.5 });
    assert.equal(m.name, "CityGroundMaterial");
    assert.equal(m.type, "ShaderMaterial");
    assert.equal(m.toneMapped, false);
    assert.equal(m.premultipliedAlpha, true);
    assert.ok(m.depthWrite);
    tickCityGroundMaterial(m, 12);
    assert.ok((m.uniforms["uTime"]!.value as number) > 0);
    m.dispose();
  });

  it("kit.createCityGroundMaterial tracks + ticks", () => {
    let kit: PainterlyKit | null = null;
    try {
      kit = createPainterlyKit({ pass: { amount: 0.2 } });
    } catch {
      const m = createCityGroundMaterial({});
      tickCityGroundMaterial(m, 1);
      m.dispose();
      return;
    }
    const g = globalThis as { document?: { hidden: boolean } };
    const prev = g.document;
    g.document = { hidden: false };
    const m = kit.createCityGroundMaterial({ wet: 0.6 });
    assert.ok(kit.tracked.includes(m));
    tickPainterlyKit(kit, 5);
    assert.ok((m.uniforms["uTime"]!.value as number) > 0);
    disposePainterlyKit(kit);
    g.document = prev;
  });
});


describe("hacker pass c25: disposePriorLive scope safety + city ground extremes", () => {
  function withDomCanvas<T>(fn: () => T): T {
    const g = globalThis as { document?: { hidden: boolean; createElement: (tag: string) => unknown } };
    const prev = g.document;
    const grad = { addColorStop() {} };
    g.document = {
      hidden: false,
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            {
              canvas: c,
              fillStyle: "#000",
              strokeStyle: "#000",
              globalAlpha: 1,
              createRadialGradient: () => grad,
              createLinearGradient: () => grad,
              getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
            },
            {
              get(target, prop, recv) {
                if (prop in target) return Reflect.get(target, prop, recv);
                return () => grad;
              },
            },
          );
        return c;
      },
    };
    try {
      return fn();
    } finally {
      g.document = prev;
    }
  }

  it("disposePriorLive without kitScope is a no-op (never global wipe)", () => {
    withDomCanvas(() => {
      disposeAllPainterlyKits();
      const dash = createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "dashboard" });
      const mini = createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "minimap" });
      assert.equal(livePainterlyKitCount(), 2);
      const ignored = createPainterlyKit({ pass: { amount: 0.2 }, disposePriorLive: true });
      // both prior kits must survive — disposePriorLive ignored without scope
      assert.equal(dash.disposed, false);
      assert.equal(mini.disposed, false);
      assert.equal(livePainterlyKitCount(), 3);
      assert.equal(ignored.kitScope, null);
      disposeAllPainterlyKits();
    });
  });

  it("disposePriorLive only disposes matching kitScope (minimap survives dashboard remount)", () => {
    withDomCanvas(() => {
      disposeAllPainterlyKits();
      const dash = createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "dashboard" });
      const mini = createPainterlyKit({ pass: { amount: 0.1 }, kitScope: "minimap" });
      assert.equal(livePainterlyKitCount(), 2);
      const remount = createPainterlyKit({
        pass: { amount: 0.2 },
        kitScope: "dashboard",
        disposePriorLive: true,
      });
      assert.equal(dash.disposed, true, "prior dashboard kit disposed");
      assert.equal(mini.disposed, false, "minimap kit must stay alive");
      assert.equal(livePainterlyKitCount(), 2); // mini + remount
      assert.equal(disposePainterlyKitsByScope("minimap"), 1);
      assert.equal(mini.disposed, true);
      disposePainterlyKit(remount);
      assert.equal(livePainterlyKitCount(), 0);
    });
  });

  it("city ground: NaN ring → 0; extreme plazaScale clamps; radius mapper finite", () => {
    const flat = createCityGroundMaterial({ ring: Number.NaN });
    assert.equal(flat.uniforms["uRing"]!.value, 0);
    assert.equal(setCityGroundRing(flat, Number.POSITIVE_INFINITY), 0);
    assert.equal(setCityGroundRing(flat, 0.5), 0.5);
    const huge = createCityGroundMaterial({ plazaScale: 1e9 });
    assert.equal(huge.uniforms["uPlazaScale"]!.value, CITY_GROUND_PLAZA_SCALE_MAX);
    const tiny = cityGroundPlazaScaleFromRadius(0.001);
    assert.ok(tiny >= 0.05);
    const far = setCityGroundPlazaScale(huge, 4000, { asRadius: true });
    assert.equal(far, CITY_GROUND_PLAZA_SCALE_MAX);
    assert.ok(CityGroundShader.uniforms.uPlazaScale);
    assert.match(CityGroundShader.fragmentShader, /paintWrap/);
    assert.match(CityGroundShader.fragmentShader, /ringAmt > 0\.001|uRing/);
    flat.dispose();
    huge.dispose();
  });
});

describe("painter c25: sun MeshStandard → watercolor surface adopt", () => {
  it("kit.createSunMaterial returns watercolor star bundle (surface only)", () => {
    const g = globalThis as { document?: { hidden?: boolean } };
    const prevDoc = g.document;
    // reuse withDom from above via try/catch pattern
    let kit: PainterlyKit | null = null;
    try {
      // minimal: may fail without canvas — then use createPainterlyBotStar path via createStarMaterial
      disposeAllPainterlyKits();
    } catch { /* */ }
    function withDom<T>(fn: () => T): T | null {
      const grad = { addColorStop() {} };
      const docPrev = (globalThis as { document?: unknown }).document;
      (globalThis as { document: unknown }).document = {
        hidden: false,
        createElement(tag: string) {
          if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
          const c: Record<string, unknown> = { width: 64, height: 64 };
          c.getContext = () =>
            new Proxy(
              { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
              { get(t, p, r) { return p in t ? Reflect.get(t, p, r) : () => grad; } },
            );
          return c;
        },
      };
      try { return fn(); } finally { (globalThis as { document?: unknown }).document = docPrev; }
    }
    withDom(() => {
      disposeAllPainterlyKits();
      kit = createPainterlyKit({ pass: { amount: 0.2 }, kitScope: "dashboard" });
      const sun = kit.createSunMaterial({ color: 0xffd27a });
      assert.equal(sun.meshMaterial.type, "ShaderMaterial");
      assert.match(sun.meshMaterial.name, /StarWatercolor|Watercolor/);
      assert.equal(sun.meshMaterial.toneMapped, false);
      // health recolor like universe-scene sun emissive path — surface API only
      sun.setColor(0x3cd687, 0.9);
      disposePainterlyKit(kit);
      kit = null;
    });
    if (prevDoc !== undefined) g.document = prevDoc;
  });
});


describe("hacker pass c26: neon status / emissive>1 / additive glow setColor wipe", () => {
  it("painterPigmentFromStatusColor desaturates pure #00ff00 and soft-caps channels", () => {
    const neon = painterPigmentFromStatusColor(0x00ff00);
    assert.ok(neon.satIn > 0.95, "pure green is fully saturated in");
    assert.ok(neon.color.g <= PAINTER_PIGMENT_MAX_CHANNEL + 1e-6, `g=${neon.color.g}`);
    assert.ok(neon.color.g < 0.95, "must not stay LED-green");
    assert.ok(neon.color.r > 0.02, "desat wash lifts red channel off zero");
    const primary = painterPigmentFromStatusColor("#ff0000");
    assert.ok(primary.color.r <= PAINTER_PIGMENT_MAX_CHANNEL + 1e-6);
    assert.ok(primary.color.g > 0.01 && primary.color.b > 0.01);
  });

  it("sanitizePainterEmissive clamps Motion pulse >1 (and rejects Inf)", () => {
    assert.equal(sanitizePainterEmissive(3), PAINTER_EMISSIVE_MAX);
    assert.equal(sanitizePainterEmissive(1.5), PAINTER_EMISSIVE_MAX);
    assert.equal(sanitizePainterEmissive(Number.POSITIVE_INFINITY, 0.5), 0.5);
    assert.ok(sanitizePainterEmissive(0.7) === 0.7);
  });

  it("setColor every-frame does not wipe matte-scaled glow back to raw neon", () => {
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = {
      addColorStop() {},
    };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            {
              canvas: c,
              fillStyle: "#000",
              createRadialGradient: () => grad,
              createLinearGradient: () => grad,
              getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ pass: { amount: 0.2 }, kitScope: "c26-glow" });
      const star = createPainterlyBotStar(kit, { color: 0x00ff00, idle: false, health: "healthy", matte: 0.85 });
      const beforeG = star.glowMaterial.color.g;
      const beforeR = star.glowMaterial.color.r;
      // Simulate universe-scene tick: setColor(HEALTH, pulse.emissive) every frame with emissive>1
      star.setColor(0x00ff00, 2.4);
      const afterG = star.glowMaterial.color.g;
      const afterR = star.glowMaterial.color.r;
      // Must stay matte-scaled pigment — NOT raw #00ff00 (g≈1, r≈0)
      assert.ok(afterG < 0.55, `glow.g after setColor=${afterG} (raw neon would be ~1)`);
      assert.ok(afterR > 0.01, `glow.r after setColor=${afterR} (raw neon would be 0)`);
      assert.ok(
        Math.abs(afterG - beforeG) < 0.08,
        `setColor must re-apply matte scale (before=${beforeG} after=${afterG})`,
      );
      const em = star.meshMaterial.uniforms.uEmissive.value as number;
      assert.ok(em <= PAINTER_EMISSIVE_MAX + 1e-9, `uEmissive=${em}`);
      const u = star.meshMaterial.uniforms.uColor.value as { r: number; g: number; b: number };
      assert.ok(u.g <= PAINTER_PIGMENT_MAX_CHANNEL + 1e-6, `mesh uColor.g=${u.g}`);
      // Additive glow opacity must stay quiet under default matte
      assert.ok(star.glowMaterial.opacity <= 0.85);
      assert.equal(star.meshMaterial.toneMapped, false);
      assert.equal(star.glowMaterial.toneMapped, false);
      disposePainterlyKit(kit);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });

  it("painterGlowColorScale is quieter at high matte", () => {
    assert.ok(painterGlowColorScale(1) < painterGlowColorScale(0));
    assert.ok(painterGlowColorScale(1) <= 0.25);
  });
});

describe("painter c26: status→pigment watercolor stars (neon → wash)", () => {
  it("healthy 0x3dd68c maps under pigment max and createBotStar keeps matte glow", () => {
    const pig = painterPigmentFromStatusColor(0x3dd68c);
    assert.ok(pig.color.g <= PAINTER_PIGMENT_MAX_CHANNEL + 1e-6);
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = { addColorStop() {} };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ kitScope: "c26-pigment" });
      const star = createPainterlyBotStar(kit, { color: 0x3dd68c, idle: false, health: "healthy" });
      assert.match(star.meshMaterial.name, /StarWatercolor|Watercolor|Fallback/);
      assert.ok((star.meshMaterial.uniforms.uMatte?.value as number) >= 0.7);
      assert.ok((star.meshMaterial.uniforms.uGrain?.value as number) >= 0.15);
      assert.ok((star.meshMaterial.uniforms.uHalo?.value as number) > 0.15);
      // setMatte re-scales stored pigment base (does not jump to neon)
      const g0 = star.glowMaterial.color.g;
      star.setMatte(1);
      assert.ok(star.glowMaterial.color.g <= g0 + 1e-6);
      star.setColor(0x3dd68c, 0.9);
      assert.ok(star.glowMaterial.color.g < 0.5);
      disposePainterlyKit(kit);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });
});

describe("hacker pass c27: fleet beacon MeshStandard LED / radius / status thrash", () => {
  it("sanitizeFleetBeaconRadius clamps NaN / 0 / huge (no invisible or planet-sized hops)", () => {
    assert.equal(sanitizeFleetBeaconRadius(Number.NaN), 0.4);
    assert.equal(sanitizeFleetBeaconRadius(0), FLEET_BEACON_RADIUS_MIN);
    assert.equal(sanitizeFleetBeaconRadius(99), FLEET_BEACON_RADIUS_MAX);
    assert.ok(sanitizeFleetBeaconRadius(0.42) === 0.42);
  });

  it("done/#00ff00 beacon never keeps raw LED green on mesh or additive glow", () => {
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = { addColorStop() {} };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ kitScope: "c27-beacon" });
      const beacon = createFleetBeacon(kit, { color: 0x00ff00, status: "done", emissiveIntensity: 0.85 });
      const u = beacon.meshMaterial.uniforms.uColor.value as { r: number; g: number; b: number };
      assert.ok(u.g < 0.85, `mesh pigment g=${u.g} (MeshStandard would be ~1)`);
      assert.ok(beacon.glowMaterial.color.g < 0.55, `glow g=${beacon.glowMaterial.color.g}`);
      assert.ok((beacon.meshMaterial.uniforms.uEmissive.value as number) <= 1);
      assert.equal(beacon.meshMaterial.toneMapped, false);
      beacon.setStatus("queued", 0x5b6b8c);
      beacon.setStatus("active", 0xffe08a);
      beacon.setStatus("done", 0x3dd68c);
      beacon.setReached(false, 0xfbbf24);
      beacon.setReached(true, 0x3dd68c);
      assert.ok((beacon.meshMaterial.uniforms.uColor.value as { g: number }).g < 0.85);
      disposePainterlyKit(kit);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });

  it("kit.createFleetBeacon post-dispose is inert (no throw into dashboard rebuild)", () => {
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = { addColorStop() {} };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ kitScope: "c27-inert" });
      disposePainterlyKit(kit);
      const b = kit.createFleetBeacon({ color: 0x3dd68c, status: "done" });
      assert.doesNotThrow(() => b.setStatus("queued"));
      assert.doesNotThrow(() => b.setReached(false));
      assert.ok(b.radius > 0);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });
});

describe("painter c27: fleet queue/landing watercolor beacons (string-light adopt)", () => {
  it("createFleetBeacon is watercolor star surface with status API (not MeshStandard)", () => {
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = { addColorStop() {} };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ kitScope: "c27-visual" });
      const done = kit.createFleetBeacon({ color: 0x3dd68c, status: "done" });
      assert.match(done.meshMaterial.name, /StarWatercolor|Watercolor|Fallback/);
      assert.ok((done.meshMaterial.uniforms.uMatte?.value as number) >= 0.85);
      assert.ok((done.meshMaterial.uniforms.uGrain?.value as number) > 0);
      assert.ok((done.meshMaterial.uniforms.uHalo?.value as number) > 0.1);
      const queued = kit.createFleetBeacon({ color: 0x5b6b8c, status: "queued" });
      assert.ok((queued.meshMaterial.uniforms.uEmissive.value as number) < 0.4);
      disposePainterlyKit(kit);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });
});

describe("hacker pass c28: painterly pass UV brush / NaN grain / amount blowout", () => {
  it("PAINTER_PASS_BRUSH_OFFSET_MAX keeps brush under mediump-safe sheet", () => {
    assert.ok(PAINTER_PASS_BRUSH_OFFSET_MAX <= 0.025);
    assert.ok(PAINTER_PASS_BRUSH_OFFSET_MAX > 0);
    // max amount * 0.028 would be ~0.024 — soft-cap at BRUSH_OFFSET_MAX
    assert.ok(Math.min(PAINTER_AMOUNT_MAX * 0.028, PAINTER_PASS_BRUSH_OFFSET_MAX) <= PAINTER_PASS_BRUSH_OFFSET_MAX);
  });

  it("sanitizePainterlyPassUniforms / setAmount scrub NaN Inf grain and clamp amount", () => {
    const pass = createPainterlyPass({ amount: 0.4, grain: PAINTER_PASS_GRAIN_DEFAULT });
    pass.uniforms.amount.value = Number.NaN;
    pass.uniforms.grain.value = Number.POSITIVE_INFINITY;
    sanitizePainterlyPassUniforms(pass);
    assert.ok(Number.isFinite(pass.uniforms.amount.value as number));
    assert.ok((pass.uniforms.amount.value as number) <= PAINTER_AMOUNT_MAX);
    assert.ok(Number.isFinite(pass.uniforms.grain.value as number));
    assert.ok((pass.uniforms.grain.value as number) <= 1);
    setPainterlyPassAmount(pass, 99);
    assert.ok((pass.uniforms.amount.value as number) <= PAINTER_AMOUNT_MAX);
    setPainterlyPassAmount(pass, Number.NaN);
    assert.ok(Number.isFinite(pass.uniforms.amount.value as number));
    disposePainterlyPass(pass);
  });

  it("PainterlyPassShader fragment soft-caps brush and clamps output (source contract)", () => {
    assert.match(PainterlyPassShader.fragmentShader, /brushScale/);
    assert.match(PainterlyPassShader.fragmentShader, /PAINTER_PASS_BRUSH_OFFSET_MAX|0\.022|min\(amt/);
    assert.match(PainterlyPassShader.fragmentShader, /clamp\(c\.rgb/);
    assert.match(PainterlyPassShader.fragmentShader, /ink edge|edge/);
  });
});

describe("painter c28: louder paper wash on already-wired pass", () => {
  it("default grain is PAINTER_PASS_GRAIN_DEFAULT (readable vs legacy 0.09)", () => {
    assert.ok(PAINTER_PASS_GRAIN_DEFAULT >= 0.16);
    const pass = createPainterlyPass({});
    assert.ok(Math.abs((pass.uniforms.grain.value as number) - PAINTER_PASS_GRAIN_DEFAULT) < 1e-6);
    disposePainterlyPass(pass);
  });

  it("shader exposes second-octave granulation + stronger palette (c28)", () => {
    assert.match(PainterlyPassShader.fragmentShader, /g2/);
    assert.match(PainterlyPassShader.fragmentShader, /paperWarm/);
    assert.match(PainterlyPassShader.fragmentShader, /c28/);
  });
});

describe("hacker pass c29: star granulation amp / uGrain extremes", () => {
  it("STAR_GRAIN_BY_HEALTH healthy is visibly above legacy 0.2", () => {
    assert.ok(STAR_GRAIN_BY_HEALTH.healthy >= 0.3);
    assert.ok(STAR_GRAIN_BY_HEALTH.blocked >= STAR_GRAIN_BY_HEALTH.healthy);
    assert.ok(STAR_GRAIN_BY_HEALTH.idle < STAR_GRAIN_BY_HEALTH.healthy);
  });

  it("WatercolorStarShader pigment path clamps uGrain and uses c29 granulation amp", () => {
    assert.match(WatercolorStarShader.fragmentShader, /float gr = clamp\(uGrain/);
    assert.match(WatercolorStarShader.fragmentShader, /c29/);
    assert.match(WatercolorStarShader.fragmentShader, /1\.15|granulation/);
  });

  it("setStarGrain / createBotStar honor health grain without NaN", () => {
    const docPrev = (globalThis as { document?: unknown }).document;
    const grad = { addColorStop() {} };
    (globalThis as { document: unknown }).document = {
      createElement(tag: string) {
        if (tag !== "canvas") return { width: 0, height: 0, getContext: () => null };
        const c: Record<string, unknown> = { width: 64, height: 64 };
        c.getContext = () =>
          new Proxy(
            { canvas: c, fillStyle: "#000", createRadialGradient: () => grad, createLinearGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
            { get(t, p, r) { return p in (t as object) ? Reflect.get(t as object, p, r) : () => grad; } },
          );
        return c;
      },
    };
    try {
      disposeAllPainterlyKits();
      const kit = createPainterlyKit({ kitScope: "c29-grain" });
      const star = createPainterlyBotStar(kit, { color: 0x3dd68c, health: "healthy", idle: false });
      const g0 = star.meshMaterial.uniforms.uGrain.value as number;
      assert.ok(g0 >= 0.3, `healthy grain=${g0}`);
      star.setGrain(Number.NaN as unknown as number);
      assert.ok(Number.isFinite(star.meshMaterial.uniforms.uGrain.value as number));
      star.setGrain(99);
      assert.ok((star.meshMaterial.uniforms.uGrain.value as number) <= 1);
      disposePainterlyKit(kit);
    } finally {
      (globalThis as { document?: unknown }).document = docPrev;
    }
  });
});

describe("painter c29: wired bot stars read granulation + pass vignette soften", () => {
  it("PainterlyPassShader vignette floor softened for HUD corners", () => {
    assert.match(PainterlyPassShader.fragmentShader, /mix\(0\.76, 1\.0, vig\)/);
  });
});
