/**
 * WCAG 2.x contrast helpers for DOM text / chart lines over the 3D scene
 * (light lane, queue #68). Pure, no DOM/WebGL.
 *
 * Colour convention: "encoded" = sRGB-encoded 0..1 values as the browser shows
 * them. The dashboard composer has no OutputPass / colorspace conversion, so
 * the composer render targets already hold display-referred (encoded) values —
 * a readback is directly comparable with CSS colours.
 */

export type Rgb = readonly [number, number, number];

/** WCAG 1.4.3 AA normal text. */
export const WCAG_TEXT_AA = 4.5;
/** WCAG 1.4.3 AA large text / 1.4.11 non-text (chart lines, axes, focus rings). */
export const WCAG_GRAPHIC_AA = 3;
/** WCAG 1.4.6 AAA normal text. */
export const WCAG_TEXT_AAA = 7;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function srgbToLinear(c: number): number {
  const x = clamp01(c);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(l: number): number {
  const x = clamp01(l);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function validRgb(rgb: unknown): rgb is Rgb {
  return Array.isArray(rgb) && rgb.length >= 3 && fin(rgb[0]) && fin(rgb[1]) && fin(rgb[2]);
}

/** WCAG relative luminance of an encoded sRGB colour. Junk → null (never guessed). */
export function relativeLuminance(rgb: Rgb | null | undefined): number | null {
  if (!validRgb(rgb)) return null;
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** WCAG contrast ratio of two relative luminances (order-free). Junk → null. */
export function contrastRatio(la: number | null | undefined, lb: number | null | undefined): number | null {
  if (!fin(la) || !fin(lb)) return null;
  const a = clamp01(la);
  const b = clamp01(lb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Alpha-composite `fg` over `bg` in encoded space (how browsers blend CSS). */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): [number, number, number] {
  const a = fin(alpha) ? clamp01(alpha) : 1;
  return [0, 1, 2].map((i) => clamp01(fg[i]! * a + bg[i]! * (1 - a))) as [number, number, number];
}

export type CssColor = { rgb: [number, number, number]; alpha: number };

/**
 * Parse a computed CSS colour (`getComputedStyle(el).color` / `backgroundColor`):
 * `rgb(r, g, b)`, `rgba(r, g, b, a)`, `rgb(r g b / a)`, `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, `transparent`. Anything else → null (caller falls
 * back to the static dim; colours are never invented).
 */
export function parseCssColor(input: unknown): CssColor | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1]!;
    if (![3, 4, 6, 8].includes(h.length)) return null;
    const short = h.length <= 4;
    const parts = short ? h.split("").map((c) => c + c) : h.match(/../g)!;
    const n = parts.map((p) => parseInt(p, 16) / 255);
    return { rgb: [n[0]!, n[1]!, n[2]!], alpha: n.length > 3 ? n[3]! : 1 };
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const body = fn[1]!.replace(/\s*\/\s*/, " / ");
  const [chans, alphaPart] = body.includes(" / ") ? body.split(" / ") : [body, undefined];
  const nums = chans!.split(/[\s,]+/).filter(Boolean);
  let alphaStr = alphaPart;
  if (nums.length === 4 && alphaStr === undefined) alphaStr = nums.pop();
  if (nums.length !== 3) return null;
  const ch = nums.map((v) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v)));
  if (!ch.every(fin)) return null;
  let alpha = 1;
  if (alphaStr !== undefined) {
    const a = alphaStr.trim();
    alpha = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    if (!fin(alpha)) return null;
  }
  return { rgb: ch.map((v) => clamp01(v / 255)) as [number, number, number], alpha: clamp01(alpha) };
}

export type ContrastInputs = {
  /** Text / line colour (encoded sRGB 0..1). */
  textRgb: Rgb;
  /** Measured backdrop relative luminance (worst-case, e.g. p90 of the rect). */
  backdropLum: number;
  /** Card background (encoded) + alpha composited over the scene. Omit → bare text over scene. */
  cardRgb?: Rgb | null;
  cardAlpha?: number | null;
  /** Required ratio (default WCAG_TEXT_AA). */
  target?: number;
  /** Max dim the pass may apply (0..1). */
  maxDim: number;
};

export type ContrastPlan = {
  /** Dim strength to apply to the scene backdrop (0 = none needed). */
  dim: number;
  /** Ratio with no dim. */
  before: number;
  /** Ratio after applying `dim`. */
  after: number;
  target: number;
  /** False when even maxDim can't reach target (or dimming can't help: dark text). */
  reachable: boolean;
};

/** Contrast of the text against the effective backdrop after multiplying the scene by `k`. */
function ratioAt(i: Required<Pick<ContrastInputs, "textRgb">> & { g: number; card: Rgb | null; a: number }, k: number): number {
  const scene: Rgb = [i.g * k, i.g * k, i.g * k];
  const bg = i.card && i.a > 0 ? compositeOver(i.card, i.a, scene) : scene;
  return contrastRatio(relativeLuminance(i.textRgb), relativeLuminance(bg))!;
}

/**
 * Smallest backdrop dim (scene multiplied by 1-dim in encoded space, as the
 * #67 dim shader does) so text reaches `target` against the measured backdrop,
 * card background composited in. Junk → null (caller keeps static #67 dim).
 * Works for text lighter OR darker than the raw backdrop (dimming a backdrop
 * brighter than light text first passes through equal luminance). When even
 * maxDim can't reach the target `reachable` is false; if dimming can't help at
 * all (dark text) dim is 0.
 */
export function dimForContrast(inp: ContrastInputs | null | undefined): ContrastPlan | null {
  if (!inp || !validRgb(inp.textRgb) || !fin(inp.backdropLum) || !fin(inp.maxDim)) return null;
  const target = fin(inp.target) && inp.target >= 1 ? inp.target : WCAG_TEXT_AA;
  const maxDim = clamp01(inp.maxDim);
  const card = inp.cardRgb && validRgb(inp.cardRgb) ? inp.cardRgb : null;
  const a = card ? (fin(inp.cardAlpha) ? clamp01(inp.cardAlpha) : 1) : 0;
  // Measured luminance → equivalent grey (encoded) so the dim multiplies like the shader.
  const g = linearToSrgb(clamp01(inp.backdropLum));
  const ctx = { textRgb: inp.textRgb, g, card, a };
  const before = ratioAt(ctx, 1);
  if (before >= target) return { dim: 0, before, after: before, target, reachable: true };
  const atMax = ratioAt(ctx, 1 - maxDim);
  if (atMax < target) {
    // Dimming can't get there. If it doesn't even help (dark text: the ratio
    // only falls as the backdrop darkens toward it) apply none.
    return atMax > before
      ? { dim: maxDim, before, after: atMax, target, reachable: false }
      : { dim: 0, before, after: before, target, reachable: false };
  }
  // Ratio vs dim falls while the backdrop is brighter than the text, then rises
  // monotonically once it's darker. `before` < target, so the answer is the
  // first crossing on the rising branch: coarse scan, then bisection.
  const STEPS = 64;
  let lo = 0;
  let hi = maxDim;
  for (let n = 1; n <= STEPS; n++) {
    const d = (maxDim * n) / STEPS;
    if (ratioAt(ctx, 1 - d) >= target) {
      hi = d;
      lo = (maxDim * (n - 1)) / STEPS;
      break;
    }
  }
  for (let n = 0; n < 32; n++) {
    const mid = (lo + hi) / 2;
    if (ratioAt(ctx, 1 - mid) >= target) hi = mid;
    else lo = mid;
  }
  return { dim: hi, before, after: ratioAt(ctx, 1 - hi), target, reachable: true };
}
