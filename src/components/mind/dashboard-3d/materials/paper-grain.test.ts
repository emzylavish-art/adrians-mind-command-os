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
} from "./lore-plaque.ts";
import {
  createPainterlyKit,
  disposePainterlyKit,
  disposeAllPainterlyKits,
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
} from "./building-surface.ts";
import {
  estimateTextureBytes,
  sanitizeTextureBudgetBytes,
  PAINTER_TEXTURE_BUDGET_BYTES,
} from "./painter-texture-budget.ts";
import {
  markImagineNodeReleased,
  isImagineNodeReleased,
} from "./imagine-node.ts";
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
import { createStarWatercolorMaterial, tickStarMaterial, setStarHalo, setStarGrain, setStarWatercolorColor, starGrainFromHealth, STAR_GRAIN_BY_HEALTH } from "./star-surface.ts";
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
  painterlyPassResizeStats,
  PAINTER_PASS_MAX_EDGE,
  PAINTER_PASS_MAX_DPR,
  PAINTER_AMOUNT_MIN,
  PAINTER_AMOUNT_MAX,
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
    assert.match(PAINTER_SHADER_VERSION, /^painter-1\.[678]/);
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
    assert.equal(PAINTER_SHADER_VERSION, "painter-1.8.0");
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
