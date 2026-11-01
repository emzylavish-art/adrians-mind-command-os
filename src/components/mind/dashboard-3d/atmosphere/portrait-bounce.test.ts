import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  BOUNCE_CHROMA,
  BOUNCE_EASE_MS,
  BOUNCE_INTENSITY,
  averageLinearRgb,
  bouncePlacement,
  bounceRgbFromAverage,
  createPortraitBounce,
  portraitTextureOf,
  sampleTextureAverage,
  type PixelReader,
} from "./portrait-bounce.ts";

function rgba(n: number, px: [number, number, number, number]): Uint8Array {
  const a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) a.set(px, i * 4);
  return a;
}
function dataTex(px: [number, number, number, number], w = 4, h = 4): THREE.DataTexture {
  return new THREE.DataTexture(rgba(w * h, px), w, h);
}
const readyImg = { complete: true, naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 };
function imgTex(img: object): THREE.Texture {
  const t = new THREE.Texture();
  t.image = img as never;
  return t;
}

describe("portrait bounce (#60) — real average colour, neutral fallback", () => {
  it("averageLinearRgb: alpha-weighted, skips transparent, junk → null", () => {
    const red = averageLinearRgb(rgba(4, [255, 0, 0, 255]), 2, 2)!;
    assert.deepEqual(red.map((v) => +v.toFixed(3)), [1, 0, 0]);
    // transparent green pixels ignored
    const mix = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]);
    assert.deepEqual(averageLinearRgb(mix, 2, 1)!.map((v) => +v.toFixed(3)), [1, 0, 0]);
    assert.equal(averageLinearRgb(rgba(4, [9, 9, 9, 0]), 2, 2), null);
    assert.equal(averageLinearRgb(null, 2, 2), null);
    assert.equal(averageLinearRgb(new Uint8Array(3), 2, 2), null);
    assert.equal(averageLinearRgb(rgba(4, [1, 1, 1, 255]), NaN, 2), null);
  });

  it("bounceRgbFromAverage keeps hue, mixes with neutral; null/black/junk → neutral white", () => {
    const c = bounceRgbFromAverage([0.2, 0.1, 0]);
    assert.deepEqual(c.map((v) => +v.toFixed(3)), [1, +(1 - BOUNCE_CHROMA + BOUNCE_CHROMA * 0.5).toFixed(3), +(1 - BOUNCE_CHROMA).toFixed(3)]);
    for (const junk of [null, undefined, [0, 0, 0], [NaN, 1, 1], [-1, 0, 0], [1]]) {
      assert.deepEqual(bounceRgbFromAverage(junk as never), [1, 1, 1]);
    }
  });

  it("sampleTextureAverage: DataTexture direct; image via reader; loading → null; tainted → error", () => {
    assert.ok(sampleTextureAverage(dataTex([0, 0, 255, 255])).rgb![2] > 0.99);
    const reader: PixelReader = (_img, edge) => rgba(edge * edge, [0, 255, 0, 255]);
    assert.ok(sampleTextureAverage(imgTex(readyImg), reader).rgb![1] > 0.99);
    const loading = sampleTextureAverage(imgTex({ complete: false, naturalWidth: 0 }), reader);
    assert.deepEqual(loading, { rgb: null, error: null });
    const tainted: PixelReader = () => {
      const e = new Error("The canvas has been tainted");
      e.name = "SecurityError";
      throw e;
    };
    const t = sampleTextureAverage(imgTex(readyImg), tainted);
    assert.equal(t.rgb, null);
    assert.match(t.error!, /SecurityError/);
    assert.deepEqual(sampleTextureAverage(null), { rgb: null, error: null });
  });

  it("portraitTextureOf only returns a texture when uHasImage=1", () => {
    const tex = new THREE.Texture();
    assert.equal(portraitTextureOf({ uniforms: { uImage: { value: tex }, uHasImage: { value: 1 } } }), tex);
    assert.equal(portraitTextureOf({ uniforms: { uImage: { value: tex }, uHasImage: { value: 0 } } }), null);
    assert.equal(portraitTextureOf(null), null);
    assert.equal(portraitTextureOf({ uniforms: { uImage: { value: {} }, uHasImage: { value: 1 } } }), null);
  });

  it("bouncePlacement sits below the node, camera side; junk → null", () => {
    const p = bouncePlacement([0, 0, 0], [0, 0, 10])!;
    assert.ok(p[1] < 0, "below");
    assert.ok(p[2] > 0, "camera side");
    assert.equal(bouncePlacement([NaN, 0, 0], [0, 0, 10]), null);
    assert.equal(bouncePlacement([0, 0, 0], [0, 0, 0]), null);
  });

  it("handle: real portrait tints, unloaded stays neutral (never invented), eases, reduced snaps", () => {
    const scene = new THREE.Scene();
    let reads = 0;
    const reader: PixelReader = (_i, edge) => {
      reads += 1;
      return rgba(edge * edge, [255, 128, 0, 255]);
    };
    const b = createPortraitBounce(scene, { reader });
    assert.equal(b.light.visible, false);
    // Unloaded texture → neutral.
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: imgTex({ complete: false }) });
    assert.deepEqual(b.rgb, [1, 1, 1]);
    assert.equal(b.sampled, false);
    b.tick(BOUNCE_EASE_MS / 2);
    assert.ok(b.level > 0 && b.level < 1, "eases");
    b.tick(BOUNCE_EASE_MS);
    assert.equal(b.light.intensity, BOUNCE_INTENSITY);
    // Loaded portrait → warm tint from its pixels; cached across frames.
    const tex = imgTex(readyImg);
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: tex });
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: tex });
    assert.equal(reads, 1, "cached per texture");
    assert.equal(b.sampled, true);
    assert.ok(b.rgb[0] > b.rgb[1] && b.rgb[1] > b.rgb[2], "orange portrait → warm bounce");
    b.tick(BOUNCE_EASE_MS);
    assert.ok(Math.abs(b.light.color.r - b.rgb[0]) < 1e-6);
    // texture.version bump (new image) re-samples
    tex.needsUpdate = true;
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: tex });
    assert.equal(reads, 2);
    // Reduced motion: snap off.
    b.setFocus(null, { reducedMotion: true });
    assert.equal(b.level, 0);
    assert.equal(b.light.visible, false);
    b.dispose();
    assert.equal(scene.children.includes(b.light), false);
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: tex });
    assert.equal(b.level, 0, "disposed no-ops");
  });

  it("tainted portrait → neutral + lastSampleError recorded (not silent)", () => {
    const b = createPortraitBounce(new THREE.Scene(), {
      reader: () => {
        throw new Error("tainted");
      },
    });
    b.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], texture: imgTex(readyImg) }, { reducedMotion: true });
    assert.deepEqual(b.rgb, [1, 1, 1]);
    assert.match(b.lastSampleError!, /tainted/);
    assert.equal(b.level, 1);
    b.dispose();
  });
});
