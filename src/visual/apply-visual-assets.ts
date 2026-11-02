import {
  VISUAL_ASSET_MAP,
  VISUAL_ASSETS_READY_CLASS,
  type VisualAssetId,
} from "./asset-keys.ts";
import { resolveVisualAssetUrlById } from "./resolve-asset-urls.ts";

let started = false;

function schedule(fn: () => void) {
  if (typeof window === "undefined") return;
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout: 1800 });
    return;
  }
  if (document.readyState === "complete") {
    setTimeout(fn, 0);
  } else {
    window.addEventListener("load", () => setTimeout(fn, 0), { once: true });
  }
}

function setCssVars(urls: Record<VisualAssetId, string>) {
  const root = document.documentElement;
  for (const entry of Object.values(VISUAL_ASSET_MAP)) {
    const url = urls[entry.id];
    if (!url) continue;
    root.style.setProperty(entry.cssVar, `url("${url}")`);
  }
}

/** Swap plain `/<key>` <img> srcs to signed (or fallback) URLs after paint. */
function rewritePlainAssetImgs(urls: Record<VisualAssetId, string>) {
  const byKey = new Map<string, string>();
  for (const entry of Object.values(VISUAL_ASSET_MAP)) {
    const url = urls[entry.id];
    if (!url) continue;
    byKey.set(entry.key, url);
    if (entry.jpgKey) byKey.set(entry.jpgKey, url);
    if (entry.avifKey) byKey.set(entry.avifKey, url);
  }
  document.querySelectorAll("img[src]").forEach((node) => {
    const img = node as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("/") || src.startsWith("//")) return;
    const key = src.replace(/^\/+/, "");
    const next = byKey.get(key);
    if (next && next !== src) img.src = next;
  });
}

/**
 * Load deferred visual CSS (textures / heavy glass re-apply), resolve URLs,
 * set --tex-* vars, then flip html.visual-assets-ready so gate lifts.
 */
export function bootVisualAssets(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  schedule(() => {
    void (async () => {
      try {
        // Component-level deferred CSS import (Vite); not manualChunks.
        await import("../styles-visual-deferred.css");
      } catch {
        // CSS optional if already linked; continue with vars + class.
      }
      try {
        const urls = await resolveVisualAssetUrlById();
        setCssVars(urls);
        rewritePlainAssetImgs(urls);
      } catch {
        // Keep solid shell if resolver fails.
      }
      document.documentElement.classList.add(VISUAL_ASSETS_READY_CLASS);
    })();
  });
}
