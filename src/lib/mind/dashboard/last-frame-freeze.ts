/**
 * Gap #3 / queue #25 — keep the last painted WebGL frame across context-loss
 * and UniverseScene remount instead of flashing the "Painting the universe…" splash.
 *
 * Pattern: snapshot canvas → absolutely-positioned <img> over the mount host.
 * Comparable to 3d-force-graph pauseAnimation / keep-last-frame.
 */

export const LAST_FRAME_ATTR = "data-dash3d-last-frame";

export type CanvasLike = {
  toDataURL?: (type?: string, quality?: number) => string;
  width?: number;
  height?: number;
};

/** Capture a PNG data-URL; returns null when the canvas cannot be read. */
export function captureCanvasFrame(canvas: CanvasLike | null | undefined): string | null {
  if (!canvas || typeof canvas.toDataURL !== "function") return null;
  const w = Number(canvas.width) || 0;
  const h = Number(canvas.height) || 0;
  if (!(w > 0 && h > 0)) return null;
  try {
    const url = canvas.toDataURL("image/png");
    if (typeof url !== "string" || !url.startsWith("data:image")) return null;
    // Guard absurd payloads (SwiftShader / lost context often yields tiny empty PNG).
    if (url.length < 32) return null;
    return url;
  } catch {
    return null;
  }
}

export function findLastFrameEl(host: ParentNode | null | undefined): HTMLElement | null {
  if (!host || typeof (host as Element).querySelector !== "function") return null;
  return (host as Element).querySelector(`[${LAST_FRAME_ATTR}]`) as HTMLElement | null;
}

/** Show (or replace) a freeze <img> covering the host. Returns the element or null. */
export function showLastFrameFreeze(
  host: HTMLElement | null | undefined,
  dataUrl: string | null | undefined,
): HTMLImageElement | null {
  if (!host || !dataUrl || !dataUrl.startsWith("data:image")) return null;
  let img = findLastFrameEl(host) as HTMLImageElement | null;
  if (!img) {
    img = document.createElement("img");
    img.setAttribute(LAST_FRAME_ATTR, "1");
    img.setAttribute("data-testid", "dash3d-last-frame");
    img.alt = "";
    img.draggable = false;
    img.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:2;";
    host.appendChild(img);
  }
  if (img.getAttribute("src") !== dataUrl) img.src = dataUrl;
  img.hidden = false;
  return img;
}

/** Hide + remove freeze layer (safe if absent). */
export function hideLastFrameFreeze(host: ParentNode | null | undefined): void {
  const img = findLastFrameEl(host);
  if (!img) return;
  img.remove();
}

/** True when a freeze layer is currently mounted (splash should stay suppressed). */
export function hasLastFrameFreeze(host: ParentNode | null | undefined): boolean {
  return !!findLastFrameEl(host);
}
