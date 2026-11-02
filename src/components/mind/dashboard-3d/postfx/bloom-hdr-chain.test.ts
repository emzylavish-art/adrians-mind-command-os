import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { BLOOM_BY_TONE, bloomMipSizes, createTunedBloomPass } from "./bloom-tuning.ts";
import {
  CHAIN_ENCODE_MARK,
  chainDecode,
  chainEncode,
  createChainEncoder,
  patchChainFragment,
} from "./bloom-hdr-chain.ts";
import { createFocusBloomGuard } from "./focus-bloom-guard.ts";

/**
 * #125 Light — HDR-safe byte bloom chain.
 * (a) handle wiring against a fake r187 renderer (same shape as vram-ledger.test);
 * (b) CPU model of the real UnrealBloomPass chain (its own kernels, mip sizes,
 *     composite factors) with HalfFloat / stock byte / encoded byte storage.
 */
type Caps = { exts?: string[] };
const glRenderer = (caps: Caps = { exts: [] }) => {
  const props = new WeakMap<object, Record<string, unknown>>();
  let bound: THREE.WebGLRenderTarget | null = null;
  return {
    capabilities: { isWebGL2: true },
    extensions: { has: (n: string) => (caps.exts ?? []).includes(n) },
    properties: {
      has: (o: object) => props.has(o),
      get: (o: object) => {
        if (!props.has(o)) props.set(o, {});
        return props.get(o)!;
      },
    },
    getContext: () => ({ FRAMEBUFFER: 0x8d40, FRAMEBUFFER_COMPLETE: 0x8cd5, checkFramebufferStatus: () => 0x8cd5 }),
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      bound = t;
    },
    getRenderTarget: () => bound,
    render: () => {},
    clear: () => {},
    getClearColor: (c: THREE.Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => {},
    autoClear: true,
    state: { buffers: { stencil: { setTest: () => {} } } },
  };
};
const asGl = (r: ReturnType<typeof glRenderer>) => r as unknown as THREE.WebGLRenderer;
const pair = (type: THREE.TextureDataType) => {
  const read = new THREE.WebGLRenderTarget(640, 360, { type });
  return { read, write: read.clone() };
};
const chainMats = (b: ReturnType<typeof createTunedBloomPass>) => [
  ...b.pass.separableBlurMaterials,
  b.pass.compositeMaterial,
  (b.pass as unknown as { blendMaterial: THREE.ShaderMaterial }).blendMaterial,
  b.pass.materialHighPassFilter,
];
const patched = (m: THREE.ShaderMaterial) => m.fragmentShader.includes(CHAIN_ENCODE_MARK);

describe("#125 HDR-safe byte bloom chain — handle", () => {
  it("byte chain over an HDR composer (no renderable RGBA16F) → encoded, every chain material patched + shared uniform", () => {
    const r = glRenderer({ exts: [] });
    const c = pair(THREE.HalfFloatType);
    const b = createTunedBloomPass(new THREE.Vector2(640, 360), "blocked");
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.UnsignedByteType);
    assert.equal(b.chainEncoded, true);
    assert.equal(b.chainEncodeBroken, false);
    const mats = chainMats(b);
    assert.ok(mats.every(patched));
    const u0 = (mats[0].uniforms as Record<string, unknown>).uChainEncode;
    assert.ok(mats.every((m) => (m.uniforms as Record<string, unknown>).uChainEncode === u0), "one shared toggle");
    assert.equal((u0 as { value: number }).value, 1);
    b.dispose();
  });

  it("HalfFloat chain stays stock — no shader patched (no recompile, bit-identical)", () => {
    const half = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    const c = pair(THREE.HalfFloatType);
    half.pass.render(asGl(glRenderer({ exts: ["EXT_color_buffer_float"] })), c.write, c.read, 1 / 60, false);
    assert.equal(half.chainType, THREE.HalfFloatType);
    assert.equal(half.chainEncoded, false);
    assert.ok(!chainMats(half).some(patched));
    half.dispose();
  });

  it("painter c20 byte composer → byte chain is encoded too (deep-mip underflow, not just clipping)", () => {
    const ldr = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    const c = pair(THREE.UnsignedByteType);
    ldr.pass.render(asGl(glRenderer({ exts: ["EXT_color_buffer_float"] })), c.write, c.read, 1 / 60, false);
    assert.equal(ldr.chainType, THREE.UnsignedByteType);
    assert.equal(ldr.chainEncoded, true);
    ldr.dispose();
  });

  it("byte → HalfFloat source flips the chain back to stock; hdrEncode:false is the clipping A/B", () => {
    const r = glRenderer({ exts: ["EXT_color_buffer_float"] });
    const hdr = pair(THREE.HalfFloatType);
    const ldr = pair(THREE.UnsignedByteType);
    const b = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    b.pass.render(asGl(r), ldr.write, ldr.read, 1 / 60, false);
    assert.equal(b.chainEncoded, true);
    b.pass.render(asGl(r), hdr.write, hdr.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.HalfFloatType);
    assert.equal(b.chainEncoded, false, "uniform off → patched shaders run the stock math");
    b.pass.render(asGl(r), ldr.write, ldr.read, 1 / 60, false);
    assert.equal(b.chainEncoded, true);
    b.dispose();
    const off = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy", { hdrEncode: false });
    off.pass.render(asGl(glRenderer({ exts: [] })), hdr.write, hdr.read, 1 / 60, false);
    assert.equal(off.chainType, THREE.UnsignedByteType);
    assert.equal(off.chainEncoded, false);
    off.dispose();
    const forced = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy", { chainFormat: "byte" });
    forced.pass.render(asGl(glRenderer({ exts: ["EXT_color_buffer_float"] })), hdr.write, hdr.read, 1 / 60, false);
    assert.equal(forced.chainType, THREE.UnsignedByteType);
    assert.equal(forced.chainEncoded, true);
    forced.dispose();
  });

  it("focus bloom guard's high pass is encoded too (else the blur would decode raw radiance)", () => {
    const r = glRenderer({ exts: [] });
    const c = pair(THREE.HalfFloatType);
    const b = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    const guard = createFocusBloomGuard(b);
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();
    guard.setFocus(new THREE.Vector3(0, 0, 0), cam, { reducedMotion: true });
    assert.equal(guard.active, true);
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    const gm = b.pass.materialHighPassFilter;
    assert.equal(gm.name, "FocusBloomGuard");
    assert.ok(patched(gm));
    assert.equal(b.chainEncoded, true);
    guard.setFocus(null, cam, { reducedMotion: true });
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    assert.notEqual(b.pass.materialHighPassFilter, gm);
    assert.ok(patched(b.pass.materialHighPassFilter));
    assert.equal(b.chainEncoded, true);
    guard.dispose();
    b.dispose();
  });

  it("decode reads get per-sampler texel sizes from the bound texture each draw (WebGL1-safe)", () => {
    const r = glRenderer({ exts: [] });
    const c = pair(THREE.HalfFloatType);
    const b = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    b.pass.render(asGl(r), c.write, c.read, 1 / 60, false);
    const comp = b.pass.compositeMaterial;
    assert.ok(comp.fragmentShader.includes("uniform vec2 blurTexture5_lcTexel;"));
    assert.ok(comp.fragmentShader.includes("lightChainTex(blurTexture1, blurTexture1_lcTexel,"));
    comp.onBeforeRender(asGl(r), new THREE.Scene(), new THREE.Camera(), new THREE.BufferGeometry(), new THREE.Mesh(), null as never);
    const u = comp.uniforms as Record<string, { value: THREE.Vector2 }>;
    const v4 = b.pass.renderTargetsVertical[4];
    assert.ok(Math.abs(u.blurTexture5_lcTexel.value.x - 1 / v4.width) < 1e-12);
    assert.ok(Math.abs(u.blurTexture5_lcTexel.value.y - 1 / v4.height) < 1e-12);
    const blur0 = b.pass.separableBlurMaterials[0];
    (blur0.uniforms as Record<string, { value: unknown }>).colorTexture.value = b.pass.renderTargetBright.texture;
    blur0.onBeforeRender(asGl(r), new THREE.Scene(), new THREE.Camera(), new THREE.BufferGeometry(), new THREE.Mesh(), null as never);
    assert.ok(Math.abs((blur0.uniforms as Record<string, { value: THREE.Vector2 }>).colorTexture_lcTexel.value.x - 1 / b.pass.renderTargetBright.width) < 1e-12);
    (blur0.uniforms as Record<string, { value: unknown }>).colorTexture.value = null;
    blur0.onBeforeRender(asGl(r), new THREE.Scene(), new THREE.Camera(), new THREE.BufferGeometry(), new THREE.Mesh(), null as never);
    assert.equal((blur0.uniforms as Record<string, { value: THREE.Vector2 }>).colorTexture_lcTexel.value.x, 0, "unknown → single-tap fallback");
    b.dispose();
  });

  it("hook missing → whole chain stays stock (all-or-nothing, sticky, no throw)", () => {
    const b = createTunedBloomPass(new THREE.Vector2(640, 360), "healthy");
    b.pass.compositeMaterial.fragmentShader = "/* future three */";
    const c = pair(THREE.HalfFloatType);
    b.pass.render(asGl(glRenderer({ exts: [] })), c.write, c.read, 1 / 60, false);
    assert.equal(b.chainType, THREE.UnsignedByteType);
    assert.equal(b.chainEncoded, false);
    assert.equal(b.chainEncodeBroken, true);
    assert.ok(!b.pass.separableBlurMaterials.some(patched), "no half-encoded chain");
    b.dispose();
    const enc = createChainEncoder({});
    assert.equal(enc.sync(true), false);
    assert.equal(enc.uniform.value, 0);
  });

  it("patchChainFragment: one wrapped main, all texture2D reads decoded, idempotent, rejects junk", () => {
    const src = "uniform sampler2D t; varying vec2 vUv;\nvoid main() {\n  gl_FragColor = texture2D( t, vUv ) + texture2D(t, vUv);\n}";
    const out = patchChainFragment(src, { decode: true, encode: true })!;
    assert.equal((out.match(/void\s+main\s*\(/g) ?? []).length, 1);
    assert.ok(out.includes("void lightChainMain_()"));
    assert.equal((out.match(/lightChainTex\(/g) ?? []).length, 3, "2 reads + helper definition");
    assert.equal(patchChainFragment(out, { decode: true, encode: true }), out);
    assert.equal(patchChainFragment("void foo(){}", { decode: false, encode: true }), null);
    assert.equal(patchChainFragment("void main(){ gl_FragColor = vec4(1.0); }", { decode: true, encode: false }), null);
    assert.equal(patchChainFragment("", { decode: false, encode: true }), null);
    const ver = patchChainFragment("#version 300 es\nvoid main(){}", { decode: false, encode: true })!;
    assert.ok(ver.startsWith("#version 300 es\n"));
    // 8-bit round trip: first code ≈1.5e-5 (dim tails survive), ≤2.5% error 0.02..12, range to ~127.
    assert.ok(chainDecode(1 / 255) < 2e-5);
    for (const v of [0.02, 0.5, 0.98, 1, 2.5, 12]) {
      const q = Math.round(chainEncode(v) * 255) / 255;
      assert.ok(Math.abs(chainDecode(q) - v) / v < 0.025, `8-bit round trip ${v} → ${chainDecode(q)}`);
    }
    assert.ok(chainDecode(1) > 100);
  });
});

// ---------------------------------------------------------------------------
// CPU model of the real chain.
type Tex = { w: number; h: number; d: Float32Array };
type Mode = "half" | "byte" | "enc";
const tex = (w: number, h: number): Tex => ({ w, h, d: new Float32Array(w * h) });
const bilinear = (t: Tex, u: number, v: number) => {
  const x = Math.min(t.w - 1, Math.max(0, u * t.w - 0.5));
  const y = Math.min(t.h - 1, Math.max(0, v * t.h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(t.w - 1, x0 + 1);
  const y1 = Math.min(t.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const g = (xx: number, yy: number) => t.d[yy * t.w + xx];
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
};
const store = (mode: Mode, c: number) => {
  if (mode === "half") return c;
  const e = mode === "enc" ? chainEncode(c) : Math.min(1, Math.max(0, c));
  return Math.round(e * 255) / 255;
};
/** GPU path of lightChainTex: decode the 4 texel centres, then lerp (cached per texture). */
const decoded = new WeakMap<Tex, Tex>();
const read = (mode: Mode, t: Tex, u: number, v: number) => {
  if (mode !== "enc") return bilinear(t, u, v);
  let d = decoded.get(t);
  if (!d) decoded.set(t, (d = { w: t.w, h: t.h, d: t.d.map(chainDecode) }));
  return bilinear(d, u, v);
};

type Kernel = { cw: number; off: number[]; wt: number[] };
const kernelsOf = (b: ReturnType<typeof createTunedBloomPass>): Kernel[] =>
  b.pass.separableBlurMaterials.map((m) => {
    const u = m.uniforms as Record<string, { value: unknown }>;
    return { cw: u.centerWeight.value as number, off: [...(u.gaussianOffsets.value as number[])], wt: [...(u.gaussianWeights.value as number[])] };
  });

function runChain(src: Tex, mode: Mode, tone: keyof typeof BLOOM_BY_TONE) {
  const b = createTunedBloomPass(new THREE.Vector2(src.w, src.h), tone);
  const ks = kernelsOf(b);
  const { strength, radius, threshold } = BLOOM_BY_TONE[tone];
  b.dispose();
  const mips = bloomMipSizes(src.w, src.h, 5);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const bright = tex(mips[0][0], mips[0][1]);
  for (let y = 0; y < bright.h; y++)
    for (let x = 0; x < bright.w; x++) {
      const c = bilinear(src, (x + 0.5) / bright.w, (y + 0.5) / bright.h); // source read (not encoded)
      bright.d[y * bright.w + x] = store(mode, c * smooth(threshold, threshold + 0.01, c));
    }
  let input = bright;
  const verts: Tex[] = [];
  for (let i = 0; i < 5; i++) {
    const [mw, mh] = mips[i];
    const k = ks[i];
    const pass1 = (inp: Tex, dx: number, dy: number) => {
      const out = tex(mw, mh);
      for (let y = 0; y < mh; y++)
        for (let x = 0; x < mw; x++) {
          const u = (x + 0.5) / mw;
          const v = (y + 0.5) / mh;
          let s = read(mode, inp, u, v) * k.cw;
          for (let j = 0; j < k.off.length; j++) {
            const ou = (dx * k.off[j]) / mw;
            const ov = (dy * k.off[j]) / mh;
            s += (read(mode, inp, u + ou, v + ov) + read(mode, inp, u - ou, v - ov)) * k.wt[j];
          }
          out.d[y * mw + x] = store(mode, s);
        }
      return out;
    };
    const hT = pass1(input, 1, 0);
    const vT = pass1(hT, 0, 1);
    verts.push(vT);
    input = vT;
  }
  const factors = [1.0, 0.8, 0.6, 0.4, 0.2].map((f) => f + (1.2 - 2 * f) * radius);
  const comp = tex(mips[0][0], mips[0][1]);
  for (let y = 0; y < comp.h; y++)
    for (let x = 0; x < comp.w; x++) {
      const u = (x + 0.5) / comp.w;
      const v = (y + 0.5) / comp.h;
      let s = 0;
      for (let i = 0; i < 5; i++) s += factors[i] * read(mode, verts[i], u, v);
      comp.d[y * comp.w + x] = store(mode, 3 * strength * s);
    }
  const added = tex(src.w, src.h); // what the blend adds onto the HDR readBuffer
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) added.d[y * src.w + x] = read(mode, comp, (x + 0.5) / src.w, (y + 0.5) / src.h);
  return added;
}

const disk = (t: Tex, cx: number, cy: number, r: number, v: number) => {
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) t.d[y * t.w + x] = v;
};
const scene = (stars: Array<[number, number, number, number]>) => {
  const t = tex(256, 256);
  t.d.fill(0.02);
  for (const s of stars) disk(t, ...s);
  return t;
};
const sum = (t: Tex, pick: (x: number, y: number) => boolean = () => true) => {
  let s = 0;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) if (pick(x, y)) s += t.d[y * t.w + x];
  return s;
};
/** Distance from (cx, cy) along +x where the added bloom first drops below `floor`. */
const reach = (t: Tex, cx: number, cy: number, floor: number) => {
  for (let x = Math.ceil(cx); x < t.w; x++) if (t.d[Math.floor(cy) * t.w + x] < floor) return x - cx;
  return t.w - cx;
};

describe("#125 HDR-safe byte bloom chain — CPU model of the real r187 chain", () => {
  it("HDR sun core (12) + blocked tone star (2.5): encoded byte ≈ HalfFloat; stock byte loses most halo energy", () => {
    const src = scene([
      [80, 128, 4, 12],
      [190, 128, 2.5, 2.5],
    ]);
    const out: Record<Mode, Tex> = { half: runChain(src, "half", "blocked"), byte: runChain(src, "byte", "blocked"), enc: runChain(src, "enc", "blocked") };
    const ring = (x: number, y: number) => Math.hypot(x + 0.5 - 80, y + 0.5 - 128) > 12; // halo outside the sun core
    const e = (m: Mode) => sum(out[m]);
    const r = (m: Mode) => sum(out[m], ring);
    const reachOf = (m: Mode) => reach(out[m], 80, 128, 0.02);
    console.log(
      `[#125] blocked: total bloom energy half ${e("half").toFixed(1)} | byte ${e("byte").toFixed(1)} (${((e("byte") / e("half")) * 100).toFixed(1)}%) | enc ${e("enc").toFixed(1)} (${((e("enc") / e("half")) * 100).toFixed(1)}%); halo ring byte ${((r("byte") / r("half")) * 100).toFixed(1)}% enc ${((r("enc") / r("half")) * 100).toFixed(1)}%; sun reach(0.02) half ${reachOf("half").toFixed(1)} byte ${reachOf("byte").toFixed(1)} enc ${reachOf("enc").toFixed(1)} px; sun core peak half ${out.half.d[128 * 256 + 80].toFixed(2)} byte ${out.byte.d[128 * 256 + 80].toFixed(2)} enc ${out.enc.d[128 * 256 + 80].toFixed(2)}`,
    );
    assert.ok(e("byte") / e("half") < 0.5, "stock byte chain clips most of the HDR halo");
    assert.ok(Math.abs(e("enc") / e("half") - 1) < 0.05, "encoded byte within 5% of HalfFloat energy");
    assert.ok(Math.abs(r("enc") / r("half") - 1) < 0.06, "halo ring within 6%");
    assert.ok(Math.abs(reachOf("enc") - reachOf("half")) <= 2, "same halo reach");
    assert.ok(reachOf("byte") < reachOf("half") - 4, "stock byte halo is visibly shorter");
  });

  it("painter star at the ≤0.98 matte (healthy tone): encoded byte keeps HalfFloat energy; threshold untouched", () => {
    const src = scene([[128, 128, 2, 0.98]]);
    const half = runChain(src, "half", "healthy");
    const byte = runChain(src, "byte", "healthy");
    const enc = runChain(src, "enc", "healthy");
    const tail = (x: number, y: number) => Math.hypot(x + 0.5 - 128, y + 0.5 - 128) > 20;
    console.log(
      `[#125] painter 0.98: energy byte ${((sum(byte) / sum(half)) * 100).toFixed(1)}% enc ${((sum(enc) / sum(half)) * 100).toFixed(1)}%; far tail (>20px) byte ${((sum(byte, tail) / sum(half, tail)) * 100).toFixed(1)}% enc ${((sum(enc, tail) / sum(half, tail)) * 100).toFixed(1)}%; core half ${half.d[128 * 256 + 128].toFixed(3)} byte ${byte.d[128 * 256 + 128].toFixed(3)} enc ${enc.d[128 * 256 + 128].toFixed(3)}`,
    );
    assert.ok(Math.abs(sum(enc) / sum(half) - 1) < 0.05);
    assert.ok(Math.abs(sum(enc, tail) / sum(half, tail) - 1) < 0.1, "dim tail keeps its 1/255 step");
    assert.equal(BLOOM_BY_TONE.healthy.threshold, 0.24, "no threshold chase for painter stars");
  });
});
