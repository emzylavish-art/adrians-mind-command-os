/**
 * Visual brand asset keys for Media Storage Fleet bucket `media-brand`.
 * Object key = path under public/ (e.g. brand/textures/frost-card-texture.webp).
 * Do not import Fleet's asset-url.ts here — resolve via resolve-asset-urls.ts.
 */

export type VisualAssetId =
  | "heroBg"
  | "logoMark"
  | "frost"
  | "heroGrain"
  | "heroAtmosphere"
  | "panelNoise"
  | "emptyWell"
  | "chartGrid"
  | "emptyIllustration"
  | "og";

export type VisualAssetEntry = {
  id: VisualAssetId;
  /** media-brand object key (preferred modern format). */
  key: string;
  /** CSS custom property set after first paint. */
  cssVar: string;
  /** Optional AVIF key for <picture> / future image() — CSS uses webp today. */
  avifKey?: string;
  /** JPG fallback key still in public/ for ancient clients. */
  jpgKey?: string;
};

/** Canonical map. Prefer webp keys for quota + transfer. */
export const VISUAL_ASSET_MAP: Record<VisualAssetId, VisualAssetEntry> = {
  heroBg: {
    id: "heroBg",
    key: "brand/hero-bg.webp",
    cssVar: "--tex-hero-bg",
    avifKey: "brand/hero-bg.avif",
    jpgKey: "brand/hero-bg.jpg",
  },
  logoMark: {
    id: "logoMark",
    key: "brand/logo-mark.webp",
    cssVar: "--tex-logo-mark",
    avifKey: "brand/logo-mark.avif",
    jpgKey: "brand/logo-mark.jpg",
  },
  frost: {
    id: "frost",
    key: "brand/textures/frost-card-texture.webp",
    cssVar: "--tex-frost",
    avifKey: "brand/textures/frost-card-texture.avif",
    jpgKey: "brand/textures/frost-card-texture.jpg",
  },
  heroGrain: {
    id: "heroGrain",
    key: "brand/textures/hero-mono-grain.webp",
    cssVar: "--tex-hero-grain",
    avifKey: "brand/textures/hero-mono-grain.avif",
    jpgKey: "brand/textures/hero-mono-grain.jpg",
  },
  heroAtmosphere: {
    id: "heroAtmosphere",
    key: "brand/textures/hero-atmosphere-mono.webp",
    cssVar: "--tex-hero-atmosphere",
    avifKey: "brand/textures/hero-atmosphere-mono.avif",
    jpgKey: "brand/textures/hero-atmosphere-mono.jpg",
  },
  panelNoise: {
    id: "panelNoise",
    key: "brand/textures/panel-noise-mono.webp",
    cssVar: "--tex-panel-noise",
    avifKey: "brand/textures/panel-noise-mono.avif",
    jpgKey: "brand/textures/panel-noise-mono.jpg",
  },
  emptyWell: {
    id: "emptyWell",
    key: "brand/textures/empty-well-mono.webp",
    cssVar: "--tex-empty-well",
    avifKey: "brand/textures/empty-well-mono.avif",
    jpgKey: "brand/textures/empty-well-mono.jpg",
  },
  chartGrid: {
    id: "chartGrid",
    key: "brand/textures/chart-grid-mono.webp",
    cssVar: "--tex-chart-grid",
    avifKey: "brand/textures/chart-grid-mono.avif",
    jpgKey: "brand/textures/chart-grid-mono.jpg",
  },
  emptyIllustration: {
    id: "emptyIllustration",
    key: "brand/textures/empty-state-illustration-mono.webp",
    cssVar: "--tex-empty-illustration",
    avifKey: "brand/textures/empty-state-illustration-mono.avif",
    jpgKey: "brand/textures/empty-state-illustration-mono.jpg",
  },
  og: {
    id: "og",
    key: "og.webp",
    cssVar: "--tex-og",
    avifKey: "og.avif",
    jpgKey: "og.jpg",
  },
};

export const VISUAL_ASSET_KEYS: string[] = Object.values(VISUAL_ASSET_MAP).map((e) => e.key);

export const VISUAL_ASSETS_READY_CLASS = "visual-assets-ready";
