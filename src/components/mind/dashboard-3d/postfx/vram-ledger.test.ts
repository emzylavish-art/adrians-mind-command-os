import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { bloomChainType, createTunedBloomPass } from "./bloom-tuning.ts";
import { createGodRayPass } from "./god-rays.ts";
import { createRegionReader } from "./backdrop-meter.ts";
import { createContextLossRecovery } from "./context-loss.ts";
import { formatMeterBadge } from "./meter-badge.ts";
import {
  formatVramBadge,
  measurePostfxVram,
  postfxVramBytes,
  postfxVramLedger,
  renderTargetAllocated,
  renderTargetBytes,
  vramSourceCount,
} from "./vram-ledger.ts";

/**
 * #120 postfx VRAM ledger + c114 hacker (bloom chain format guard).
 * The fake renderer mirrors three r187's bookkeeping: a target gets
 * `properties.__webglFramebuffer` on first bind and loses it on `rt.dispose()`
 * (which RenderTarget.setSize also triggers on a size change).
 */
type Caps = { exts?: string[]; complete?: (type: number) => boolean };
const glRenderer = (caps: Caps = { exts: ["EXT_color_buffer_float"] }) => {
  const props = new WeakMap<object, Record<string, unknown>>();
  let bound: THREE.WebGLRenderTarget | null = null;
  const binds: number[] = [];
  const alloc = (rt: THREE.WebGLRenderTarget) => {
    if (!props.has(rt)) {
      props.set(rt, {});
      const onDispose = () => {
        props.delete(rt);
        rt.removeEventListener("dispose", onDispose);
      };
      rt.addEventListener("dispose", onDispose);
    }
    const p = props.get(rt)!;
    if (p.__webglFramebuffer === undefined) {
      p.__webglFramebuffer = {};
      binds.push(rt.texture.type);
    }
  };
  return {
    binds,
    capabilities: { isWebGL2: true },
    extensions: { has: (n: string) => (caps.exts ?? []).includes(n) },
    properties: {
      has: (o: object) => props.has(o),
      get: (o: object) => {
        if (!props.has(o)) props.set(o, {});
        return props.get(o)!;
      },
    },
    getContext: () => ({
      FRAMEBUFFER: 0x8d40,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      checkFramebufferStatus: () => (!bound || !caps.complete || caps.complete(bound.texture.type) ? 0x8cd5 : 0x8cd6),
    }),
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      bound = t;
      if (t) alloc(t);
    },
    getRenderTarget: () => bound,
    render: () => {},
    clear: () => {},
    getClearColor: (c: THREE.Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => {},
    readRenderTargetPixels: () => {},
    autoClear: true,
    state: { buffers: { stencil: { setTest: () => {} } } },
  };
};
type R = ReturnType<typeof glRenderer>;
const asGl = (r: R) => r as unknown as THREE.WebGLRenderer;

/** Composer read/write pair as the scene builds it (HalfFloat, read has a DepthTexture). */
const composerPair = (w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType) => {
  const read = new THREE.WebGLRenderTarget(w, h, { type, depthTexture: new THREE.DepthTexture(w, h) });
  const write = read.clone();
  return { read, write };
};

/** One composer frame through the light-owned passes that hold targets. */
const frame = (
  r: R,
  c: { read: THREE.WebGLRenderTarget; write: THREE.WebGLRenderTarget },
  bloom: ReturnType<typeof createTunedBloomPass> | null,
  rays: ReturnType<typeof createGodRayPass> | null,
) => {
  r.setRenderTarget(c.read); // RenderPass
  r.setRenderTarget(c.write);
  rays?.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
  bloom?.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
};

const stack = async (r: R, w: number, h: number) => {
  const c = composerPair(w, h);
  const bloom = createTunedBloomPass(new THREE.Vector2(w, h), "healthy");
  const rays = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
  const meter = createRegionReader(2);
  frame(r, c, bloom, rays);
  await meter.read(asGl(r) as never, c.read.texture, [[0.1, 0.1, 0.2, 0.2]]);
  return { c, bloom, rays, meter };
};
const teardown = (s: Awaited<ReturnType<typeof stack>>) => {
  s.rays.dispose();
  s.bloom.dispose();
  s.meter.dispose();
  s.c.read.dispose();
  s.c.write.dispose();
};

describe("#120 render-target byte accounting", () => {
  it("bytes come from real size × texel type × format (+ depth, + MSAA)", () => {
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(10, 10, { type: THREE.HalfFloatType, depthBuffer: false })), 800);
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(10, 10, { depthBuffer: false })), 400);
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(10, 10, { type: THREE.HalfFloatType })), 800 + 400, "24-bit depth renderbuffer");
    const dt = new THREE.WebGLRenderTarget(10, 10, { depthTexture: new THREE.DepthTexture(10, 10) });
    assert.equal(renderTargetBytes(dt), 400 + 400);
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(10, 10, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false })), 400);
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(10, 10, { depthBuffer: false, samples: 4 })), 400 * 5);
    assert.equal(renderTargetBytes(new THREE.WebGLRenderTarget(0, 0)), 0);
    assert.equal(renderTargetBytes(null), 0);
  });

  it("allocated basis: a disposed / never-bound target is not counted; partial renderer → declared", () => {
    const r = glRenderer();
    const rt = new THREE.WebGLRenderTarget(8, 8, { depthBuffer: false });
    assert.equal(renderTargetAllocated(r, rt), false);
    r.setRenderTarget(rt);
    assert.equal(renderTargetAllocated(r, rt), true);
    rt.setSize(16, 16); // three frees on resize, re-allocates on next bind
    assert.equal(renderTargetAllocated(r, rt), false);
    assert.equal(renderTargetAllocated({}, rt), null);
    const l = measurePostfxVram([
      { name: "composer", snapshot: { targets: [rt, rt], renderer: {} } },
      { name: "bloom", snapshot: { targets: [rt], renderer: {} } },
    ]);
    assert.equal(l.total, 16 * 16 * 4, "de-duplicated across sources");
    assert.equal(l.basis, "declared");
    assert.equal(l.bySource.composer, 1024);
    assert.equal(l.bySource.bloom, 0);
  });
});

describe("c114 hacker: bloom mip chain format guard", () => {
  it("repro: WebGL2 without EXT_color_buffer_float — stock chain is HalfFloat (incomplete FBO, bloom silently black); guarded chain is byte", () => {
    const r = glRenderer({ exts: [] });
    const c = composerPair(1920, 1080);
    const stock = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy", { chainFormat: "stock" });
    stock.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.equal(stock.chainType, THREE.HalfFloatType);
    assert.ok(stock.chainTargets.every((t) => t.texture.type === THREE.HalfFloatType), "the bug: unrenderable RGBA16F chain");
    stock.dispose();
    const b = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.UnsignedByteType);
    assert.ok(b.chainTargets.every((t) => t.texture.type === THREE.UnsignedByteType));
    b.dispose();
  });

  it("renderable HalfFloat keeps the HDR chain; incomplete HalfFloat FBO → byte, sticky", () => {
    const c = composerPair(1920, 1080);
    const ok = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    ok.pass.render(asGl(glRenderer({ exts: ["EXT_color_buffer_half_float"] })), c.write, c.read, 1 / 60, false);
    assert.equal(ok.chainType, THREE.HalfFloatType);
    assert.equal(ok.halfFloatRejected, false);
    ok.dispose();
    const r = glRenderer({ exts: ["EXT_color_buffer_float"], complete: (t) => t !== THREE.HalfFloatType });
    const b = createTunedBloomPass(new THREE.Vector2(1920, 1080), "healthy");
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.equal(b.halfFloatRejected, true);
    assert.equal(b.chainType, THREE.UnsignedByteType);
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.UnsignedByteType, "no per-frame re-probe");
    b.dispose();
  });

  it("painter c20 byte composer → byte chain (half the bloom VRAM); back to HDR follows the source", () => {
    const r = glRenderer();
    const hdr = composerPair(2560, 1440);
    const ldr = composerPair(2560, 1440, THREE.UnsignedByteType);
    const b = createTunedBloomPass(new THREE.Vector2(2560, 1440), "healthy");
    b.pass.render(asGl(r), hdr.write, hdr.read, 1 / 60, false);
    const hdrBloom = postfxVramLedger().bySource.bloom;
    b.pass.render(asGl(r), ldr.write, ldr.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.UnsignedByteType);
    const ldrBloom = postfxVramLedger().bySource.bloom;
    assert.ok(hdrBloom > 0);
    assert.equal(ldrBloom * 2, hdrBloom);
    b.pass.render(asGl(r), hdr.write, hdr.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.HalfFloatType);
    b.dispose();
  });

  it("partial renderers (tests, half-restored GL) keep the stock chain and never throw", () => {
    assert.equal(bloomChainType({}, THREE.HalfFloatType), null);
    assert.equal(bloomChainType(null, THREE.HalfFloatType), null);
    const b = createTunedBloomPass(new THREE.Vector2(64, 64), "idle");
    const before = b.chainType;
    const throwing = { capabilities: { isWebGL2: true }, extensions: { has: () => true }, setRenderTarget: () => { throw new Error("lost"); } };
    try {
      b.pass.render(throwing as never, null as never, new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }), 0, false);
    } catch (e) {
      // UnrealBloomPass itself fails on this double (no getClearColor); the guard must not be the thrower.
      assert.notEqual((e as Error).message, "lost");
    } finally {
      b.dispose();
    }
    assert.equal(before, THREE.HalfFloatType);
    assert.equal(b.chainType, THREE.HalfFloatType);
  });
});

describe("#120 ledger: DPR drop, reduced motion and context loss return to baseline", () => {
  it("empty before any postfx renders", () => {
    assert.equal(vramSourceCount(), 0);
    assert.equal(postfxVramBytes(), 0);
    assert.equal(postfxVramLedger().basis, "none");
  });

  it("full stack at 4480×2520: composer + bloom chain + god-ray mask + meter all counted from real targets", async () => {
    const r = glRenderer();
    const s = await stack(r, 4480, 2520);
    const l = postfxVramLedger();
    assert.equal(l.basis, "allocated");
    assert.equal(l.bySource.composer, 2 * 4480 * 2520 * (8 + 4));
    assert.equal(l.bySource.bloom, s.bloom.chainTargets.reduce((a, t) => a + t.width * t.height * 8, 0));
    assert.equal(l.bySource.rays, s.rays.maskBytes);
    assert.ok(s.rays.maskBytes > 0, ">2.5 MP → #114 mask live");
    assert.ok(l.bySource.meter > 0);
    assert.equal(l.total, l.bySource.composer + l.bySource.bloom + l.bySource.rays + l.bySource.meter);
    teardown(s);
    assert.equal(postfxVramBytes(), 0, "teardown returns to zero");
    assert.equal(vramSourceCount(), 0);
  });

  it("DPR 2 → 1 lands exactly on a fresh DPR 1 build (no stale mips or mask pinned)", async () => {
    const r = glRenderer();
    const fresh = await stack(r, 1920, 1080);
    const baseline = postfxVramBytes();
    teardown(fresh);
    const s = await stack(r, 3840, 2160);
    const high = postfxVramBytes();
    assert.ok(high > baseline * 2);
    s.c.read.setSize(1920, 1080);
    s.c.write.setSize(1920, 1080);
    s.bloom.pass.setSize(1920, 1080);
    frame(r, s.c, s.bloom, s.rays);
    assert.equal(s.rays.maskBytes, 0, "1080p-class buffer → 48 taps → mask freed");
    assert.equal(postfxVramBytes(), baseline);
    teardown(s);
  });

  it("reduced motion: god rays off frees the mask; the scene builds no composer → 0", async () => {
    const r = glRenderer();
    const s = await stack(r, 4480, 2520);
    const before = postfxVramLedger();
    s.rays.update({ healthy: 3, total: 4, reducedMotion: true });
    const after = postfxVramLedger();
    assert.equal(after.bySource.rays, 0);
    assert.equal(after.total, before.total - before.bySource.rays);
    teardown(s); // universe-scene: no composer / bundle under reduced motion
    assert.equal(postfxVramBytes(), 0);
  });

  it("context loss through createContextLossRecovery drops bloom + mask; restore returns to the same bytes", async () => {
    const r = glRenderer();
    const c = composerPair(4480, 2520);
    let bloom = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy");
    let rays = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
    const rec = createContextLossRecovery({
      initial: { bloom, godRays: rays },
      factory: () => {
        bloom = createTunedBloomPass(new THREE.Vector2(4480, 2520), "healthy");
        rays = createGodRayPass({ healthy: 3, total: 4, reducedMotion: false });
        return { bloom, godRays: rays };
      },
      onError: (stage, e) => assert.fail(`${stage}: ${String(e)}`),
    });
    frame(r, c, bloom, rays);
    const live = postfxVramLedger();
    assert.ok(live.bySource.bloom > 0 && live.bySource.rays > 0);
    rec.notifyLost();
    assert.equal(postfxVramBytes(), 0, "nothing light-owned survives loss");
    rec.notifyRestored();
    frame(r, c, bloom, rays);
    assert.deepEqual(postfxVramLedger(), live);
    rec.dispose();
    c.read.dispose();
    c.write.dispose();
    assert.equal(vramSourceCount(), 0);
  });
});

describe("#120 debug badge", () => {
  it("auto-appends the live ledger; null opts out; empty registry adds nothing", async () => {
    const contrast = { source: "static", backdropLum: null, lastError: null, reads: 0, backoff: null } as never;
    assert.ok(!formatMeterBadge(contrast).text.includes("vram"));
    const r = glRenderer();
    const s = await stack(r, 2560, 1440);
    const l = postfxVramLedger();
    const text = formatMeterBadge(contrast).text;
    assert.ok(text.endsWith(formatVramBadge(l)), text);
    assert.match(formatVramBadge(l), /^vram \d+\.\d MB \(composer \d+\.\d · bloom \d+\.\d · rays \d+\.\d · meter \d+\.\d\)$/);
    assert.ok(!formatMeterBadge(contrast, null, null, null, null).text.includes("vram"));
    teardown(s);
    assert.equal(formatVramBadge(postfxVramLedger()), "vram 0.0 MB");
  });
});
