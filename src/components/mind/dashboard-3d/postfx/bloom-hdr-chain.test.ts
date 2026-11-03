import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAIN_ENCODE_MARK,
  chainDecode,
  chainEncode,
  createChainEncoder,
  patchChainFragment,
} from "./bloom-hdr-chain.ts";

const FRAG = `
void main(void) {
  vec4 c = texture2D(blurTexture, vUv);
  gl_FragColor = c;
}
`;

describe("HDR byte bloom chain", () => {
  it("round-trips radiance through gamma-2 Reinhard", () => {
    for (const c of [0, 0.02, 0.98, 2.5, 12]) {
      const back = chainDecode(chainEncode(c));
      assert.ok(Math.abs(back - c) < 1e-6, `${c} -> ${back}`);
    }
    assert.equal(chainEncode(-1), 0);
  });

  it("patches one main and decodes texture2D reads, and refuses a second patch", () => {
    const patched = patchChainFragment(FRAG, { decode: true, encode: true });
    assert.ok(patched);
    assert.match(patched!, new RegExp(CHAIN_ENCODE_MARK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(patched!, /lightChainTex\(blurTexture/);
    assert.match(patched!, /void lightChainMain_\(\)/);
    assert.equal(patchChainFragment(patched!, { decode: true, encode: true }), patched);
    assert.equal(patchChainFragment("void main(){}", { decode: true, encode: false }), null);
  });

  it("encodes a byte chain and leaves a half-float chain stock", () => {
    const makeMat = (src: string) => ({
      fragmentShader: src,
      uniforms: {} as Record<string, { value: unknown }>,
      needsUpdate: false,
      onBeforeRender() {},
    });
    const pass = {
      materialHighPassFilter: makeMat("void main(void) { gl_FragColor = vec4(1.0); }"),
      separableBlurMaterials: [makeMat(FRAG)],
      compositeMaterial: makeMat(FRAG),
      blendMaterial: makeMat(FRAG),
    };
    const encoder = createChainEncoder(pass as never);
    assert.equal(encoder.sync(false), false);
    assert.equal(encoder.encoded, false);
    assert.equal(encoder.sync(true), true);
    assert.equal(encoder.encoded, true);
    assert.match(pass.separableBlurMaterials[0].fragmentShader, /lightChainTex/);
    assert.equal(encoder.sync(false), false);
    assert.equal(encoder.uniform.value, 0);
  });
});
