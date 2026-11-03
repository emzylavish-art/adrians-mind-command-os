import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WCAG_GRAPHIC_AA,
  WCAG_TEXT_AA,
  compositeOver,
  contrastRatio,
  dimForContrast,
  linearToSrgb,
  parseCssColor,
  relativeLuminance,
  srgbToLinear,
} from "./wcag-contrast.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

describe("wcag-contrast (#68) — WCAG 2.x maths, junk never guessed", () => {
  it("relative luminance + contrast match WCAG reference values", () => {
    near(relativeLuminance([1, 1, 1])!, 1);
    near(relativeLuminance([0, 0, 0])!, 0);
    const grey = relativeLuminance([0x77 / 255, 0x77 / 255, 0x77 / 255])!;
    near(contrastRatio(1, grey)!, 4.48, 0.01); // #777 on white: the classic 4.48 fail
    near(contrastRatio(1, 0)!, 21);
    near(contrastRatio(0, 1)!, 21, 1e-9);
    assert.equal(relativeLuminance(null), null);
    assert.equal(relativeLuminance([NaN, 0, 0] as never), null);
    assert.equal(contrastRatio(NaN, 0.5), null);
    near(linearToSrgb(srgbToLinear(0.42)), 0.42, 1e-6);
  });

  it("parseCssColor: computed-style forms; junk → null", () => {
    assert.deepEqual(parseCssColor("rgb(255, 0, 0)"), { rgb: [1, 0, 0], alpha: 1 });
    const a = parseCssColor("rgba(10, 20, 30, 0.85)")!;
    near(a.alpha, 0.85);
    near(a.rgb[2], 30 / 255);
    const modern = parseCssColor("rgb(0 128 255 / 50%)")!;
    near(modern.alpha, 0.5);
    near(modern.rgb[1], 128 / 255);
    assert.deepEqual(parseCssColor("#fff"), { rgb: [1, 1, 1], alpha: 1 });
    near(parseCssColor("#00000080")!.alpha, 128 / 255);
    assert.deepEqual(parseCssColor("transparent"), { rgb: [0, 0, 0], alpha: 0 });
    for (const junk of [null, undefined, 42, "", "red", "#12", "rgb(1,2)", "rgb(a,b,c)", "hsl(0 0% 0%)"]) {
      assert.equal(parseCssColor(junk), null, String(junk));
    }
  });

  it("compositeOver blends in encoded space", () => {
    assert.deepEqual(compositeOver([1, 1, 1], 0.5, [0, 0, 0]), [0.5, 0.5, 0.5]);
    assert.deepEqual(compositeOver([1, 0, 0], NaN, [0, 0, 1]), [1, 0, 0]);
  });

  it("dimForContrast: bright backdrop → smallest dim that reaches 4.5:1", () => {
    const p = dimForContrast({ textRgb: [0.9, 0.92, 0.96], backdropLum: 0.6, maxDim: 0.7 })!;
    assert.ok(p.before < WCAG_TEXT_AA);
    assert.ok(p.dim > 0 && p.dim <= 0.7);
    assert.equal(p.reachable, true);
    assert.ok(p.after >= WCAG_TEXT_AA - 1e-6);
    near(p.after, WCAG_TEXT_AA, 0.02); // minimal: barely over, no over-dim of the Imagine art
  });

  it("backdrop BRIGHTER than light text: dims through the crossover to reach 4.5:1", () => {
    const p = dimForContrast({ textRgb: [0.9, 0.92, 0.96], backdropLum: 0.83, maxDim: 0.7 })!;
    assert.ok(p.before < 1.1);
    assert.equal(p.reachable, true);
    assert.ok(p.after >= WCAG_TEXT_AA - 1e-6);
    near(p.after, WCAG_TEXT_AA, 0.02);
  });

  it("dark backdrop already passes → dim 0 (keeps the scene vivid)", () => {
    const p = dimForContrast({ textRgb: [1, 1, 1], backdropLum: 0.01, maxDim: 0.7 })!;
    assert.equal(p.dim, 0);
    assert.ok(p.before >= WCAG_TEXT_AA);
  });

  it("card background composited in lowers the dim needed", () => {
    const bare = dimForContrast({ textRgb: [0.9, 0.9, 0.9], backdropLum: 0.5, maxDim: 0.7 })!;
    const card = dimForContrast({
      textRgb: [0.9, 0.9, 0.9],
      backdropLum: 0.5,
      cardRgb: [0.03, 0.05, 0.1],
      cardAlpha: 0.7,
      maxDim: 0.7,
    })!;
    assert.ok(card.dim < bare.dim, `${card.dim} < ${bare.dim}`);
  });

  it("graphic target (3:1 chart lines) needs less than text", () => {
    const text = dimForContrast({ textRgb: [0.4, 0.8, 1], backdropLum: 0.35, maxDim: 0.7 })!;
    const line = dimForContrast({ textRgb: [0.4, 0.8, 1], backdropLum: 0.35, maxDim: 0.7, target: WCAG_GRAPHIC_AA })!;
    assert.ok(line.dim <= text.dim);
  });

  it("dark text / unreachable targets are reported honestly", () => {
    const dark = dimForContrast({ textRgb: [0.05, 0.05, 0.05], backdropLum: 0.1, maxDim: 0.7 })!;
    assert.equal(dark.dim, 0);
    assert.equal(dark.reachable, false);
    const aaa = dimForContrast({ textRgb: [1, 1, 1], backdropLum: 0.5, maxDim: 0.3, target: 21 })!;
    assert.equal(aaa.dim, 0.3);
    assert.equal(aaa.reachable, false);
    assert.equal(dimForContrast(null), null);
    assert.equal(dimForContrast({ textRgb: [1, 1, 1], backdropLum: NaN, maxDim: 0.5 }), null);
    assert.equal(dimForContrast({ textRgb: [1, 1] as never, backdropLum: 0.5, maxDim: 0.5 }), null);
  });
});

describe("wcag-contrast: partial dim that only hurts is never applied", () => {
  it("still on the falling branch at maxDim → dim 0, reachable false", () => {
    const p = dimForContrast({ textRgb: [0.6, 0.6, 0.6], backdropLum: 0.9, maxDim: 0.3 })!;
    assert.equal(p.dim, 0);
    assert.equal(p.reachable, false);
  });
});
