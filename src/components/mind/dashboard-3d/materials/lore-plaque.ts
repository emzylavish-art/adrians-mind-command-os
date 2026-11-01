import * as THREE from "three";
import { LorePlaqueShader } from "../shaders/lore-plaque.ts";
import {
  sanitizeFinite,
  sanitizeShaderTime,
  sanitizePaperGrainSize,
  clampTextureSizeToGpu,
  paperHash,
  GPU_SAFE_TEXTURE_DEFAULT,
} from "./paper-grain.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";

export type LorePlaqueOptions = {
  base?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  paper?: number;
  wash?: number;
  /** Optional prebuilt text atlas texture. */
  textAtlas?: THREE.Texture | null;
};

function cloneUniforms(src: typeof LorePlaqueShader.uniforms) {
  return {
    uBase: { value: new THREE.Color(src.uBase.value[0], src.uBase.value[1], src.uBase.value[2]) },
    uInk: { value: new THREE.Color(src.uInk.value[0], src.uInk.value[1], src.uInk.value[2]) },
    uAccent: { value: new THREE.Color(src.uAccent.value[0], src.uAccent.value[1], src.uAccent.value[2]) },
    uTime: { value: 0 },
    uPaper: { value: src.uPaper.value as number },
    uWash: { value: src.uWash.value as number },
    uTextMap: { value: null as THREE.Texture | null },
    uHasText: { value: 0 },
  };
}

/** Watercolor parchment plaque ShaderMaterial (constellation lore). */
export function createLorePlaqueMaterial(opts: LorePlaqueOptions = {}): THREE.ShaderMaterial {
  const uniforms = cloneUniforms(LorePlaqueShader.uniforms);
  if (opts.base != null) uniforms.uBase.value.set(opts.base);
  if (opts.ink != null) uniforms.uInk.value.set(opts.ink);
  if (opts.accent != null) uniforms.uAccent.value.set(opts.accent);
  if (opts.paper != null) uniforms.uPaper.value = sanitizeFinite(opts.paper, 0.22, 0, 1);
  if (opts.wash != null) uniforms.uWash.value = sanitizeFinite(opts.wash, 0.45, 0, 1);
  const mat = new THREE.ShaderMaterial({
    name: "LorePlaqueMaterial",
    precision: PAINTER_SHADER_PRECISION,
    uniforms,
    vertexShader: LorePlaqueShader.vertexShader,
    fragmentShader: LorePlaqueShader.fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  (mat.userData as Record<string, unknown>).loreOwnedAtlas = null;
  if (opts.textAtlas) setLorePlaqueTextAtlas(mat, opts.textAtlas, { owned: false });
  return mat;
}

export function tickLorePlaqueMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

/**
 * Procedural parchment RGBA (no external image) — warmer fiber than paperGrain.
 */
export function makeParchmentRGBA(size: number, seed = 11): Uint8ClampedArray {
  const s = sanitizePaperGrainSize(size, 256);
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n = (paperHash(i * 0.13 + x * 1.7 + y * s, seed) - 0.5) * 22;
      const fiber = paperHash(x * 0.05 + y * 3.1, seed + 4) * 28;
      data[i] = Math.min(255, Math.max(0, 42 + n + fiber * 0.35));
      data[i + 1] = Math.min(255, Math.max(0, 38 + n * 0.9 + fiber * 0.25));
      data[i + 2] = Math.min(255, Math.max(0, 28 + n * 0.7));
      data[i + 3] = 255;
    }
  }
  return data;
}

export function createParchmentTexture(size = 256, seed = 11, maxTextureSize?: number): THREE.DataTexture {
  const s = clampTextureSizeToGpu(size, maxTextureSize);
  const data = makeParchmentRGBA(s, seed);
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Caps for attacker-sized lock-note dumps into plaque content helpers. */
export const LORE_MAX_NOTES = 8;
export const LORE_MAX_CHARS_PER_NOTE = 160;

export type LoreNote = { text: string; truncated: boolean };

/**
 * Sanitize huge/odd lock-note arrays for plaque body text.
 * Rejects non-strings, strips controls, caps count + length — never silent-drop
 * without marking truncation.
 */
export function sanitizeLoreNotes(
  notes: unknown,
  maxNotes = LORE_MAX_NOTES,
  maxChars = LORE_MAX_CHARS_PER_NOTE,
): { notes: LoreNote[]; truncatedCount: number; inputCount: number } {
  const capN = Math.max(1, Math.min(32, Number.isFinite(maxNotes) ? Math.floor(maxNotes as number) : LORE_MAX_NOTES));
  const capC = Math.max(8, Math.min(512, Number.isFinite(maxChars) ? Math.floor(maxChars as number) : LORE_MAX_CHARS_PER_NOTE));
  const arr = Array.isArray(notes) ? notes : [];
  const out: LoreNote[] = [];
  let truncatedCount = 0;
  for (const raw of arr) {
    if (out.length >= capN) {
      truncatedCount += 1;
      continue;
    }
    let s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) continue;
    let truncated = false;
    if (s.length > capC) {
      s = s.slice(0, capC - 1) + "…";
      truncated = true;
      truncatedCount += 1;
    }
    out.push({ text: s, truncated });
  }
  return { notes: out, truncatedCount, inputCount: arr.length };
}

export function createParchmentTextureForGpu(
  size = 256,
  seed = 11,
  maxTextureSize?: number,
): THREE.DataTexture {
  const s = clampTextureSizeToGpu(size, maxTextureSize);
  const data = makeParchmentRGBA(s, seed);
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- c5: lore plaque text atlas (procedural canvas glyphs, no fonts/assets) ---------- */

export const LORE_ATLAS_MIN = 64;
export const LORE_ATLAS_DEFAULT = 512;
export const LORE_ATLAS_MAX = 1024;

export type LoreTextAtlasOptions = {
  width?: number;
  height?: number;
  maxTextureSize?: number;
  /** Ink fill CSS color (painterly washes drawn underneath). */
  inkCss?: string;
  accentCss?: string;
  seed?: number;
  maxNotes?: number;
  maxChars?: number;
};

export type LoreTextAtlas = {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
  lineCount: number;
  noteCount: number;
  truncatedCount: number;
  empty: boolean;
  dispose: () => void;
};

function sanitizeAtlasEdge(size: number, fallback: number, maxTextureSize?: number): number {
  const fb = Number.isFinite(fallback) ? fallback : LORE_ATLAS_DEFAULT;
  let n = Number.isFinite(size) ? Math.floor(size) : fb;
  if (n < LORE_ATLAS_MIN) n = LORE_ATLAS_MIN;
  if (n > LORE_ATLAS_MAX) n = LORE_ATLAS_MAX;
  return clampTextureSizeToGpu(n, maxTextureSize ?? GPU_SAFE_TEXTURE_DEFAULT, LORE_ATLAS_DEFAULT);
}

/**
 * Procedural canvas glyph atlas for lock-note body text on lore plaques.
 * No external fonts/assets — uses canvas default font. Safe with long/empty/unicode
 * notes via sanitizeLoreNotes. Caller MUST dispose() (or bind with owned:true on plaque).
 */
export function createLoreTextAtlas(
  notes: unknown,
  opts: LoreTextAtlasOptions = {},
): LoreTextAtlas {
  const width = sanitizeAtlasEdge(opts.width ?? LORE_ATLAS_DEFAULT, LORE_ATLAS_DEFAULT, opts.maxTextureSize);
  const height = sanitizeAtlasEdge(opts.height ?? LORE_ATLAS_DEFAULT, LORE_ATLAS_DEFAULT, opts.maxTextureSize);
  const sanitized = sanitizeLoreNotes(notes, opts.maxNotes, opts.maxChars);
  const seed = Number.isFinite(opts.seed) ? (opts.seed as number) : 3;
  const inkCss = typeof opts.inkCss === "string" && opts.inkCss ? opts.inkCss : "rgba(230,236,248,0.92)";
  const accentCss = typeof opts.accentCss === "string" && opts.accentCss ? opts.accentCss : "rgba(125,200,255,0.35)";

  // Node / no-DOM: return a tiny empty DataTexture wrapped as a disposable stand-in
  if (typeof document === "undefined") {
    const data = new Uint8ClampedArray(width * height * 4);
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat) as unknown as THREE.CanvasTexture;
    tex.needsUpdate = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    let disposed = false;
    return {
      texture: tex,
      width,
      height,
      lineCount: sanitized.notes.length === 0 ? 1 : sanitized.notes.length,
      noteCount: sanitized.notes.length,
      truncatedCount: sanitized.truncatedCount,
      empty: sanitized.notes.length === 0,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        tex.dispose();
      },
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  // Soft parchment wash under glyphs (transparent so plaque parchment shows through)
  for (let i = 0; i < 5; i++) {
    const x = paperHash(i * 17 + seed, seed) * width;
    const y = paperHash(i * 29 + seed, seed + 1) * height * 0.7 + height * 0.18;
    const r = 40 + paperHash(i + seed, seed + 2) * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, accentCss);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const padX = Math.floor(width * 0.08);
  const padTop = Math.floor(height * 0.16);
  const padBottom = Math.floor(height * 0.1);
  const lineH = Math.max(14, Math.floor(height * 0.055));
  ctx.font = `${Math.max(11, Math.floor(lineH * 0.85))}px sans-serif`;
  ctx.textBaseline = "top";

  let lineCount = 0;
  let y = padTop;
  const maxY = height - padBottom;

  if (sanitized.notes.length === 0) {
    // Honest empty — faint italic placeholder, still a valid atlas
    ctx.fillStyle = "rgba(180,190,210,0.35)";
    ctx.fillText("(no lock notes)", padX, y);
    lineCount = 1;
  } else {
    for (const note of sanitized.notes) {
      if (y + lineH > maxY) break;
      // Painterly ink: multi-pass jittered strokes
      const passes = [
        { dx: -0.6, dy: 0.4, a: 0.25 },
        { dx: 0.5, dy: -0.3, a: 0.3 },
        { dx: 0, dy: 0, a: 0.92 },
      ];
      // Word-wrap within atlas
      const words = note.text.split(" ");
      let line = "";
      const flush = (text: string) => {
        if (!text || y + lineH > maxY) return;
        for (const p of passes) {
          ctx.fillStyle = inkCss.replace(/[\d.]+\)$/ , (m) => {
            // if rgba(...a) keep structure; else solid
            return m;
          });
          if (inkCss.startsWith("rgba")) {
            const m = inkCss.match(/rgba?\(([^)]+)\)/);
            if (m) {
              const parts = m[1]!.split(",").map((s) => s.trim());
              const a = Number(parts[3] ?? 1) * p.a;
              ctx.fillStyle = `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
            }
          } else {
            ctx.globalAlpha = p.a;
            ctx.fillStyle = inkCss;
          }
          ctx.fillText(text, padX + p.dx, y + p.dy);
          ctx.globalAlpha = 1;
        }
        if (note.truncated) {
          ctx.fillStyle = "rgba(250,190,80,0.7)";
          ctx.fillText("…", width - padX - 12, y);
        }
        y += lineH;
        lineCount += 1;
      };
      for (const w of words) {
        const trial = line ? line + " " + w : w;
        if (ctx.measureText(trial).width > width - padX * 2) {
          flush(line);
          line = w;
          if (y + lineH > maxY) break;
        } else {
          line = trial;
        }
      }
      if (line && y + lineH <= maxY) flush(line);
      y += Math.floor(lineH * 0.35); // paragraph gap
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  let disposed = false;
  return {
    texture,
    width,
    height,
    lineCount,
    noteCount: sanitized.notes.length,
    truncatedCount: sanitized.truncatedCount,
    empty: sanitized.notes.length === 0,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      texture.dispose();
    },
  };
}

/**
 * Bind / clear text atlas on a lore plaque. If owned:true, plaque will dispose the
 * previous atlas on replace/release. Null clears uHasText (parchment-only plaque).
 */
export function setLorePlaqueTextAtlas(
  mat: THREE.ShaderMaterial,
  atlas: THREE.Texture | LoreTextAtlas | null | undefined,
  opts: { owned?: boolean } = {},
): void {
  if (!mat.uniforms?.["uTextMap"] || !mat.uniforms?.["uHasText"]) return;
  const prev = (mat.userData as Record<string, unknown>).loreOwnedAtlas as
    | { dispose: () => void }
    | THREE.Texture
    | null;
  if (prev) {
    try {
      if (typeof (prev as LoreTextAtlas).dispose === "function" && "texture" in (prev as object)) {
        (prev as LoreTextAtlas).dispose();
      } else if (typeof (prev as THREE.Texture).dispose === "function") {
        (prev as THREE.Texture).dispose();
      }
    } catch {
      /* */
    }
    (mat.userData as Record<string, unknown>).loreOwnedAtlas = null;
  }
  if (atlas == null) {
    mat.uniforms["uTextMap"].value = null;
    mat.uniforms["uHasText"].value = 0;
    return;
  }
  const isAtlasObj = typeof atlas === "object" && atlas !== null && "texture" in atlas && "dispose" in atlas;
  const tex = isAtlasObj ? (atlas as LoreTextAtlas).texture : (atlas as THREE.Texture);
  mat.uniforms["uTextMap"].value = tex;
  mat.uniforms["uHasText"].value = 1;
  tex.needsUpdate = true;
  if (opts.owned || isAtlasObj) {
    (mat.userData as Record<string, unknown>).loreOwnedAtlas = isAtlasObj ? atlas : tex;
  }
}

/** Dispose owned lore text atlas on a plaque (idempotent). */
export function disposeLorePlaqueOwnedAtlas(mat: THREE.ShaderMaterial): void {
  setLorePlaqueTextAtlas(mat, null);
}
