import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { createTunedBloomPass } from "./bloom-tuning.ts";
import { createChartsDepthPlatePass } from "./charts-depth-plate.ts";
import {
  POSTFX_MAX_DPR,
  createPostfxViewportRebind,
  postfxViewport,
  rebindPostfxViewport,
  viewportChange,
  watchDevicePixelRatio,
  type MatchMediaLike,
} from "./viewport-rebind.ts";

/**
 * Light #107 — god-ray / bloom DPR resize rebind.
 * EffectComposer caches its pixel ratio at construction; universe-scene's
 * onResize only calls composer.setSize(cssW, cssH), and dedupes on CSS size, so
 * a browser zoom / monitor drag leaves the composer read/write targets (and
 * the scene DepthTexture god-rays / focus-depth / bloom-guard sample) at the
 * first-frame DPR while bloom is re-sized at the new DPR.
 */
type FakeRenderer = {
  pr: number;
  w: number;
  h: number;
  calls: string[];
  getPixelRatio(): number;
  getSize(v: THREE.Vector2): THREE.Vector2;
  setPixelRatio(r: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
};
const fakeRenderer = (pr: number, w: number, h: number): FakeRenderer => ({
  pr,
  w,
  h,
  calls: [],
  getPixelRatio() {
    return this.pr;
  },
  getSize(v) {
    return v.set(this.w, this.h);
  },
  setPixelRatio(r) {
    this.calls.push(`pr:${r}`);
    this.pr = r;
  },
  setSize(w, h) {
    this.calls.push(`size:${w}x${h}`);
    this.w = w;
    this.h = h;
  },
});
/** Mirrors universe-scene: composer on a device-px RT that carries a DepthTexture. */
function buildComposer(r: FakeRenderer, cssW: number, cssH: number, dpr: number) {
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  const rt = new THREE.WebGLRenderTarget(bw, bh, { depthTexture: new THREE.DepthTexture(bw, bh) });
  return new EffectComposer(r as unknown as THREE.WebGLRenderer, rt);
}
const mip0 = (b: ReturnType<typeof createTunedBloomPass>) =>
  (b.pass as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[] }).renderTargetsHorizontal[0];

describe("#107 postfxViewport (pure)", () => {
  it("computes CSS + drawing-buffer size, clamps DPR and junk", () => {
    assert.deepEqual(postfxViewport(800, 600, 1), { cssW: 800, cssH: 600, dpr: 1, bufW: 800, bufH: 600 });
    assert.deepEqual(postfxViewport(800, 600, 2), { cssW: 800, cssH: 600, dpr: POSTFX_MAX_DPR, bufW: 1400, bufH: 1050 });
    const j = postfxViewport(Number.NaN, 0, Number.NaN);
    assert.deepEqual(j, { cssW: 1, cssH: 1, dpr: 1, bufW: 1, bufH: 1 });
    assert.equal(postfxViewport(1000, 500, 0.5).dpr, 0.5, "browser zoom-out below 1 is honoured");
    assert.equal(postfxViewport(1000, 500, 0.01).dpr, 0.25, "floor so buffers never collapse");
  });
  it("viewportChange classifies size / dpr / both / none", () => {
    const a = postfxViewport(800, 600, 1);
    assert.equal(viewportChange(null, a), "both");
    assert.equal(viewportChange(a, postfxViewport(800, 600, 1)), "none");
    assert.equal(viewportChange(a, postfxViewport(900, 600, 1)), "size");
    assert.equal(viewportChange(a, postfxViewport(800, 600, 1.5)), "dpr");
    assert.equal(viewportChange(a, postfxViewport(400, 300, 1.5)), "both");
  });
});

describe("#107 repro: CSS-only resize leaves composer at first-frame DPR", () => {
  it("old onResize order (composer.setSize only) keeps readBuffer + depth at DPR 1 after DPR→2", () => {
    const r = fakeRenderer(1, 800, 600);
    const composer = buildComposer(r, 800, 600, 1);
    // Browser zoom 200%: CSS box halves, DPR doubles — universe-scene onResize today:
    r.setSize(400, 300);
    composer.setSize(400, 300);
    r.setPixelRatio(2);
    assert.equal(composer.readBuffer.width, 400, "bug: stale DPR (should be 800 device px)");
    // (DepthTexture image is re-synced to the RT size by three at render time.)
  });

  it("rebindPostfxViewport sizes composer targets + scene depth at the live DPR", () => {
    const r = fakeRenderer(1, 800, 600);
    const composer = buildComposer(r, 800, 600, 1);
    const vp = postfxViewport(400, 300, 1.5);
    const rep = rebindPostfxViewport({ renderer: r, composer }, vp);
    assert.equal(r.pr, 1.5);
    assert.deepEqual([composer.readBuffer.width, composer.readBuffer.height], [600, 450]);
    assert.deepEqual([composer.writeBuffer.width, composer.writeBuffer.height], [600, 450]);
    assert.ok(composer.readBuffer.depthTexture, "scene depth survives the rebind");
    assert.deepEqual(rep.errors, []);
    composer.dispose();
  });

  it("constructor device-px RT makes addPass size passes at css×dpr²; rebind before addPass fixes it", () => {
    const r = fakeRenderer(1.75, 1000, 500);
    const stale = buildComposer(r, 1000, 500, 1.75);
    const b1 = createTunedBloomPass(new THREE.Vector2(1000, 500), "idle");
    stale.addPass(b1.pass);
    // _width seeded at 1750 device px → addPass sizes at 1750×1.75 = 3063 → mip0 1532 (should be 875)
    assert.equal(mip0(b1).width, 1532, "bug: dpr² oversize");
    b1.dispose();
    const fixed = buildComposer(r, 1000, 500, 1.75);
    rebindPostfxViewport({ composer: fixed }, postfxViewport(1000, 500, 1.75));
    const b2 = createTunedBloomPass(new THREE.Vector2(1000, 500), "idle");
    fixed.addPass(b2.pass);
    assert.equal(mip0(b2).width, Math.round((1000 * 1.75) / 2));
    b2.dispose();
  });
});

describe("#107 rebind handles", () => {
  it("bloom at device px + god-rays / focus-depth / bloom-guard depth rebound to the live readBuffer", () => {
    const r = fakeRenderer(1, 800, 600);
    const composer = buildComposer(r, 800, 600, 1);
    const bloom = createTunedBloomPass(new THREE.Vector2(800, 600), "idle");
    composer.addPass(bloom.pass);
    const got: Record<string, unknown> = {};
    const cam = new THREE.PerspectiveCamera();
    const rep = rebindPostfxViewport(
      {
        renderer: r,
        composer,
        camera: cam,
        bloom,
        godRays: { setDepthTexture: (t, c) => ((got.rays = t), (got.cam = c)) },
        focusDepth: { setDepthTexture: (t) => (got.fd = t) },
        bloomGuard: { setDepthTexture: (t) => (got.guard = t) },
      },
      postfxViewport(800, 600, 2),
    );
    const live = composer.readBuffer.depthTexture;
    assert.ok(live);
    assert.equal(got.rays, live);
    assert.equal(got.cam, cam);
    assert.equal(got.fd, live);
    assert.equal(got.guard, live);
    assert.equal(mip0(bloom).width, 700, "bloom mip0 = 800 css × 1.75 (clamped DPR) / 2");
    assert.deepEqual(rep.applied, ["renderer", "composer", "bloom", "godRays", "focusDepth", "bloomGuard"]);
    bloom.dispose();
    composer.dispose();
  });

  it("a throwing handle is reported, not swallowed, and the rest still rebind", () => {
    const r = fakeRenderer(1, 100, 100);
    const composer = buildComposer(r, 100, 100, 1);
    let fd = false;
    const rep = rebindPostfxViewport(
      {
        composer,
        godRays: {
          setDepthTexture() {
            throw new Error("disposed");
          },
        },
        focusDepth: { setDepthTexture: () => (fd = true) },
      },
      postfxViewport(100, 100, 1.5),
    );
    assert.equal(fd, true);
    assert.deepEqual(rep.errors.map((e) => e.stage), ["godRays"]);
    assert.match(rep.errors[0].message, /disposed/);
  });

  it("no composer depth → handles get null (luminance-only), not a stale texture", () => {
    const got: unknown[] = [];
    rebindPostfxViewport(
      { godRays: { setDepthTexture: (t) => got.push(t) }, focusDepth: { setDepthTexture: (t) => got.push(t) } },
      postfxViewport(10, 10, 1),
    );
    assert.deepEqual(got, [null, null]);
  });
});

describe("#107 createPostfxViewportRebind (dedupe on size AND dpr)", () => {
  it("DPR-only change rebinds; identical viewport is a no-op; force() re-applies", () => {
    const r = fakeRenderer(1, 800, 600);
    const composer = buildComposer(r, 800, 600, 1);
    const rb = createPostfxViewportRebind(() => ({ renderer: r, composer }));
    assert.equal(rb.resize(800, 600, 1)?.change, "both");
    assert.equal(rb.resize(800, 600, 1), null, "unchanged");
    const rep = rb.resize(800, 600, 1.5); // monitor drag: same CSS box, new DPR
    assert.equal(rep?.change, "dpr");
    assert.equal(composer.readBuffer.width, 1200);
    assert.equal(rb.force()?.change, "none");
    rb.dispose();
    assert.equal(rb.resize(10, 10, 1), null, "disposed → no-op");
    composer.dispose();
  });
  it("re-reads targets each call (context-loss rebuild swaps handles)", () => {
    let n = 0;
    let fd = 0;
    const rb = createPostfxViewportRebind(() => {
      n++;
      return { focusDepth: { setDepthTexture: () => fd++ } };
    });
    rb.resize(10, 10, 1);
    rb.resize(20, 10, 1);
    assert.equal(n, 2);
    assert.equal(fd, 2);
  });
});

describe("#107 watchDevicePixelRatio", () => {
  it("fires on DPR change and re-arms on the new resolution query; unsub detaches", () => {
    let dpr = 1;
    const lists: Array<{ q: string; fns: Set<() => void> }> = [];
    const win = {
      get devicePixelRatio() {
        return dpr;
      },
      matchMedia: ((q: string) => {
        const l = { q, fns: new Set<() => void>() };
        lists.push(l);
        return {
          addEventListener: (_: "change", f: () => void) => l.fns.add(f),
          removeEventListener: (_: "change", f: () => void) => l.fns.delete(f),
        };
      }) as MatchMediaLike,
    };
    const seen: number[] = [];
    const stop = watchDevicePixelRatio(win, (d) => seen.push(d));
    assert.equal(lists[0].q, "(resolution: 1dppx)");
    dpr = 2;
    for (const f of [...lists[0].fns]) f();
    assert.deepEqual(seen, [2]);
    assert.equal(lists[0].fns.size, 0, "old query detached");
    assert.equal(lists[1].q, "(resolution: 2dppx)");
    stop();
    assert.equal(lists[1].fns.size, 0);
  });
  it("no matchMedia (SSR / old browser) → inert unsubscribe", () => {
    const stop = watchDevicePixelRatio({ devicePixelRatio: 1 }, () => assert.fail());
    stop();
  });
});

describe("#107 charts-depth-plate CSS-px uniforms follow the live viewport", () => {
  it("feather/blur/shadow rescale on resize even while no fresh reading (fade-out)", () => {
    const p = createChartsDepthPlatePass();
    const u = p.pass.uniforms as unknown as {
      feather: { value: THREE.Vector2 };
      blurStep: { value: THREE.Vector2 };
      shadowFall: { value: number };
    };
    p.setPlate(null, null, -1, { width: 1000, height: 500 });
    assert.ok(Math.abs(u.feather.value.x - 14 / 1000) < 1e-9);
    p.setPlate(null, null, -1, { width: 2000, height: 1000 });
    assert.ok(Math.abs(u.feather.value.x - 14 / 2000) < 1e-9, `feather.x ${u.feather.value.x}`);
    assert.ok(Math.abs(u.blurStep.value.y - 3 / 1000) < 1e-9);
    assert.ok(Math.abs(u.shadowFall.value - 22 / 1000) < 1e-9);
    p.dispose();
  });
});
