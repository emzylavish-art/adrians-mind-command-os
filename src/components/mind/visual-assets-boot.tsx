import { useEffect } from "react";
import { bootVisualAssets } from "@/visual/apply-visual-assets.ts";

/** Presentational: defer brand textures / heavy glass until after first paint. */
export function VisualAssetsBoot() {
  useEffect(() => {
    bootVisualAssets();
    const font = document.getElementById("font-defer") as HTMLLinkElement | null;
    if (font && font.media === "print") {
      const activate = () => {
        font.media = "all";
      };
      font.addEventListener("load", activate, { once: true });
      // Fallback if load already fired before listener.
      requestAnimationFrame(() => {
        if (font.sheet) activate();
      });
    }
  }, []);
  return null;
}
