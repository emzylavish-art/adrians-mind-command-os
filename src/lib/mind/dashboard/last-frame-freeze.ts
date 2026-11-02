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


/** Gap#59 — honest overlay while WebGL context is lost / restoring / failed. */
export const CONTEXT_LOSS_OVERLAY_ATTR = "data-dash3d-ctx-loss";
export const CONTEXT_LOSS_MSG_PAUSED =
  "3D view paused — graphics context lost, restoring…";
export const CONTEXT_LOSS_MSG_FAILED =
  "3D view paused — graphics context restore failed. Retry to rebuild the stage.";

export type ContextLossOverlayPhase = "lost" | "restoring" | "failed" | "ok";

export function findContextLossOverlay(host: ParentNode | null | undefined): HTMLElement | null {
  if (!host || typeof (host as Element).querySelector !== "function") return null;
  return (host as Element).querySelector(`[${CONTEXT_LOSS_OVERLAY_ATTR}]`) as HTMLElement | null;
}

export function showContextLossOverlay(
  host: HTMLElement | null | undefined,
  phase: Exclude<ContextLossOverlayPhase, "ok">,
  opts?: { onRetry?: () => void },
): HTMLElement | null {
  if (!host) return null;
  let root = findContextLossOverlay(host);
  if (!root) {
    root = document.createElement("div");
    root.setAttribute(CONTEXT_LOSS_OVERLAY_ATTR, "1");
    root.setAttribute("data-testid", "dash3d-ctx-loss-overlay");
    root.setAttribute("role", "status");
    root.style.cssText =
      "position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;padding:1.25rem;pointer-events:auto;background:rgb(7 11 22 / 0.55);";
    const card = document.createElement("div");
    card.className = "dash3d-glass";
    card.style.cssText = "max-width:28rem;text-align:center;pointer-events:auto;";
    const title = document.createElement("h2");
    title.textContent = "Graphics context";
    title.style.cssText = "margin:0;font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:#93a0c2;";
    const msg = document.createElement("p");
    msg.setAttribute("data-testid", "dash3d-ctx-loss-msg");
    msg.style.cssText = "margin:0.45rem 0 0;font-size:1rem;font-weight:600;color:#f3f5ff;";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "dash3d-pill";
    retry.setAttribute("data-testid", "dash3d-ctx-loss-retry");
    retry.textContent = "Retry";
    retry.style.cssText = "margin-top:0.85rem;display:none;";
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(retry);
    root.appendChild(card);
    host.appendChild(root);
  }
  root.setAttribute("data-phase", phase);
  const msgEl = root.querySelector('[data-testid="dash3d-ctx-loss-msg"]') as HTMLElement | null;
  const retryEl = root.querySelector('[data-testid="dash3d-ctx-loss-retry"]') as HTMLButtonElement | null;
  if (msgEl) {
    msgEl.textContent = phase === "failed" ? CONTEXT_LOSS_MSG_FAILED : CONTEXT_LOSS_MSG_PAUSED;
  }
  if (retryEl) {
    const showRetry = phase === "failed";
    retryEl.style.display = showRetry ? "inline-flex" : "none";
    retryEl.onclick = showRetry && opts?.onRetry ? () => opts.onRetry!() : null;
  }
  root.hidden = false;
  return root;
}

export function hideContextLossOverlay(host: ParentNode | null | undefined): void {
  const el = findContextLossOverlay(host);
  if (!el) return;
  el.remove();
}
