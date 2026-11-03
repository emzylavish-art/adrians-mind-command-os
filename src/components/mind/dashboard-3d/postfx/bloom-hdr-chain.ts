import * as THREE from "three";

/**
 * #125 Light — HDR-safe byte bloom chain.
 *
 * c114 drops the UnrealBloomPass mip chain to 8-bit when RGBA16F isn't
 * renderable (or the HalfFloat FBO probe fails). Over an HDR (HalfFloat)
 * composer source that silently clips every chain write at 1.0: a sun core at
 * 12 enters the blur as 1, so its wide halo carries ~1/12 of its energy, and
 * the composite (3 × strength × Σ mip factors ≈ 5×) saturates the bloom core.
 *
 * The same chain also underflows at the bottom: the deep mips spread a small
 * star so thin that 8-bit rounding zeroes its tail (CPU model of the real r187
 * chain: a painter 0.98-matte star keeps 38% of its HalfFloat halo energy, 9%
 * beyond 20 px) — this hits the painter c20 byte composer fallback too.
 *
 * Fix: whenever the chain is byte, every chain write is gamma-2 Reinhard
 * encoded e = sqrt(c/(1+c)) and every chain read decodes the 4 texel centres
 * before filtering, so blurs and the composite stay linear in real radiance,
 * > 1 survives (to ~127) and the first code is ~1.5e-5. HalfFloat chain →
 * untouched.
 *
 * Materials are only patched the first time encoding is needed, so GPUs with a
 * HalfFloat chain never recompile. A patch that can't find its hook leaves the
 * whole chain un-encoded (all-or-nothing — a half-encoded chain is wrong).
 */

export const CHAIN_ENCODE_MARK = "/* light#125 chain-encode */";

/**
 * Shared GLSL helpers (uniform toggle → stock math when 0).
 *
 * Curve: gamma-2 Reinhard, e = sqrt(c/(1+c)). Plain Reinhard keeps the low end
 * at the linear 1/255 step, and the deep mips spread a small star so thin that
 * its tail underflows to 0 (CPU model: painter 0.98 star kept 38% of HalfFloat
 * energy, same as the stock byte chain); the sqrt puts the first code at
 * ~1.5e-5 and still holds ~127 at the top.
 *
 * Reads: the curve is concave, so letting the hardware bilinear-filter encoded
 * texels (UnrealBloom's merged-pair taps sit between texels) under-reads every
 * edge — sun halo energy fell to 58–67% in the model. lightChainTex() fetches
 * the 4 texel centres, decodes each, then lerps (exact linear filtering of real
 * radiance). Texel size per sampler comes from `<sampler>_lcTexel`, refreshed
 * in material.onBeforeRender from the bound texture (works on WebGL1 too).
 */
export const CHAIN_ENCODE_GLSL = /* glsl */ `
${CHAIN_ENCODE_MARK}
uniform float uChainEncode;
vec3 lightChainEnc(vec3 c) { c = max(c, vec3(0.0)); return sqrt(c / (vec3(1.0) + c)); }
vec3 lightChainDec(vec3 e) { vec3 r = e * e; return r / max(vec3(1.0) - r, vec3(1.0 / 255.0)); }
vec4 lightChainTex(sampler2D s, vec2 texel, vec2 uv) {
  if (uChainEncode < 0.5) return texture2D(s, uv);
  vec3 d;
  if (texel.x <= 0.0 || texel.y <= 0.0) {
    d = lightChainDec(texture2D(s, uv).rgb);
  } else {
    vec2 p = uv / texel - 0.5;
    vec2 f = fract(p);
    vec2 b = (floor(p) + 0.5) * texel;
    vec3 c00 = lightChainDec(texture2D(s, b).rgb);
    vec3 c10 = lightChainDec(texture2D(s, b + vec2(texel.x, 0.0)).rgb);
    vec3 c01 = lightChainDec(texture2D(s, b + vec2(0.0, texel.y)).rgb);
    vec3 c11 = lightChainDec(texture2D(s, b + texel).rgb);
    d = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
  }
  return vec4(d, max(d.r, max(d.g, d.b)));
}
`;

/** CPU mirrors of the shader (tests / models). */
export const chainEncode = (c: number) => (c > 0 ? Math.sqrt(c / (1 + c)) : 0);
export const chainDecode = (e: number) => {
  const r = e * e;
  return r / Math.max(1 - r, 1 / 255);
};

export type ChainEncodeUniform = { value: number };

type PatchOpts = { decode: boolean; encode: boolean };

const MAIN_RE = /void\s+main\s*\(\s*(?:void)?\s*\)/g;
const TEX_RE = /\btexture2D\s*\(\s*([A-Za-z_]\w*)\s*,/g;
const texelName = (sampler: string) => `${sampler}_lcTexel`;

/** Sampler names a decode patch reads (for the texel-size uniforms). */
export function chainSamplers(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(TEX_RE)) out.add(m[1]);
  return [...out];
}

/**
 * Patch a fragment source. Returns null when a required hook is missing (or
 * ambiguous), so the caller can keep the chain stock.
 */
export function patchChainFragment(src: string, opts: PatchOpts): string | null {
  if (typeof src !== "string" || !src) return null;
  if (src.includes(CHAIN_ENCODE_MARK)) return src;
  let out = src;
  let decls = "";
  if (opts.decode) {
    const samplers = chainSamplers(out);
    if (samplers.length === 0) return null;
    out = out.replace(TEX_RE, (_m, name: string) => `lightChainTex(${name}, ${texelName(name)},`);
    decls = samplers.map((n) => `uniform vec2 ${texelName(n)};`).join("\n");
  }
  if (opts.encode) {
    const n = (out.match(MAIN_RE) ?? []).length;
    if (n !== 1) return null;
    out = out.replace(MAIN_RE, "void lightChainMain_()");
    out +=
      "\nvoid main() {\n  lightChainMain_();\n  if (uChainEncode > 0.5) gl_FragColor.rgb = lightChainEnc(gl_FragColor.rgb);\n}\n";
  }
  // Helpers go in front, after any #version / #extension lines.
  const lines = out.split("\n");
  let at = 0;
  while (at < lines.length && /^\s*(#version|#extension|$)/.test(lines[at])) at++;
  lines.splice(at, 0, CHAIN_ENCODE_GLSL + decls);
  return lines.join("\n");
}

type TexLike = { image?: { width?: number; height?: number } | null } | null | undefined;

/** 1/size of a bound texture, [0,0] when unknown (shader falls back to a single decoded tap). */
export function texelOf(t: TexLike): [number, number] {
  const w = t?.image?.width;
  const h = t?.image?.height;
  return typeof w === "number" && typeof h === "number" && w >= 1 && h >= 1 ? [1 / w, 1 / h] : [0, 0];
}

const PATCHED = new WeakSet<object>();

/** Patch a material in place (idempotent). False → hook missing, untouched. */
export function patchChainMaterial(
  mat: THREE.ShaderMaterial | null | undefined,
  u: ChainEncodeUniform,
  opts: PatchOpts,
): boolean {
  if (!mat || typeof mat.fragmentShader !== "string") return false;
  const uniforms = (mat.uniforms ?? (mat.uniforms = {})) as Record<string, { value: unknown }>;
  if (PATCHED.has(mat) && mat.fragmentShader.includes(CHAIN_ENCODE_MARK)) {
    uniforms.uChainEncode = u;
    return true;
  }
  const samplers = opts.decode ? chainSamplers(mat.fragmentShader) : [];
  const next = patchChainFragment(mat.fragmentShader, opts);
  if (next === null) return false;
  mat.fragmentShader = next;
  uniforms.uChainEncode = u;
  if (samplers.length) {
    for (const n of samplers) uniforms[texelName(n)] = { value: new THREE.Vector2(0, 0) };
    const prev = mat.onBeforeRender;
    mat.onBeforeRender = function chainTexelSync(...args: Parameters<THREE.Material["onBeforeRender"]>) {
      for (const n of samplers) {
        const [x, y] = texelOf(uniforms[n]?.value as TexLike);
        (uniforms[texelName(n)].value as THREE.Vector2).set(x, y);
      }
      return prev.apply(this, args);
    };
  }
  PATCHED.add(mat);
  mat.needsUpdate = true;
  return true;
}

type ChainPassLike = {
  materialHighPassFilter?: THREE.ShaderMaterial;
  separableBlurMaterials?: THREE.ShaderMaterial[];
  compositeMaterial?: THREE.ShaderMaterial;
  blendMaterial?: THREE.ShaderMaterial;
};

export type ChainEncoder = {
  /** Shared uniform object (all patched chain materials). */
  readonly uniform: ChainEncodeUniform;
  /**
   * Per frame, before the stock render: `want` = byte chain. Patches lazily;
   * returns whether this frame is encoded.
   */
  sync: (want: boolean) => boolean;
  /** True once a chain hook couldn't be patched (stays stock, sticky). */
  readonly broken: boolean;
  readonly encoded: boolean;
};

/** #125: encoder bound to one UnrealBloomPass (re-reads the live high pass). */
export function createChainEncoder(pass: ChainPassLike): ChainEncoder {
  const uniform: ChainEncodeUniform = { value: 0 };
  let core = false; // blur + composite + blend patched
  let broken = false;
  const patchCore = () => {
    if (core || broken) return core;
    const blurs = pass.separableBlurMaterials ?? [];
    const ok =
      blurs.length > 0 &&
      !!pass.compositeMaterial &&
      !!pass.blendMaterial &&
      blurs.every((m) => patchChainFragment(m?.fragmentShader, { decode: true, encode: true }) !== null) &&
      patchChainFragment(pass.compositeMaterial.fragmentShader, { decode: true, encode: true }) !== null &&
      patchChainFragment(pass.blendMaterial.fragmentShader, { decode: true, encode: false }) !== null;
    if (!ok) {
      broken = true;
      return false;
    }
    for (const m of blurs) patchChainMaterial(m, uniform, { decode: true, encode: true });
    patchChainMaterial(pass.compositeMaterial!, uniform, { decode: true, encode: true });
    patchChainMaterial(pass.blendMaterial!, uniform, { decode: true, encode: false });
    core = true;
    return true;
  };
  const sync = (want: boolean) => {
    if (!want || broken) {
      uniform.value = 0;
      return false;
    }
    if (!patchCore()) {
      uniform.value = 0;
      return false;
    }
    // The active high pass may be the stock/prefilter one or the focus guard's.
    const hpOk = patchChainMaterial(pass.materialHighPassFilter, uniform, { decode: false, encode: true });
    uniform.value = hpOk ? 1 : 0;
    return hpOk;
  };
  return {
    uniform,
    sync,
    get broken() {
      return broken;
    },
    get encoded() {
      return uniform.value > 0.5;
    },
  };
}
