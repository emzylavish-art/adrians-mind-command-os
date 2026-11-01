import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAST_FRAME_ATTR,
  captureCanvasFrame,
  findLastFrameEl,
  hasLastFrameFreeze,
  hideLastFrameFreeze,
  showLastFrameFreeze,
} from "./last-frame-freeze.ts";

/** Minimal host so we do not need happy-dom in node:test. */
function makeHost() {
  const children: any[] = [];
  const host: any = {
    children,
    appendChild(el: any) {
      children.push(el);
      el.parentNode = host;
      return el;
    },
    querySelector(sel: string) {
      if (!sel.includes(LAST_FRAME_ATTR)) return null;
      return children.find((c) => c.getAttribute?.(LAST_FRAME_ATTR) === "1") ?? null;
    },
  };
  return host;
}

function makeImgFactory(origCreate: typeof document.createElement | undefined) {
  // Patch via global if present; else inject factory through show by stubbing document
}

describe("last-frame-freeze (#25 Gap#3)", () => {
  it("captureCanvasFrame rejects empty / hostile canvases", () => {
    assert.equal(captureCanvasFrame(null), null);
    assert.equal(captureCanvasFrame({}), null);
    assert.equal(captureCanvasFrame({ width: 0, height: 10, toDataURL: () => "data:image/png;base64,xx" }), null);
    assert.equal(
      captureCanvasFrame({
        width: 8,
        height: 8,
        toDataURL: () => {
          throw new Error("context lost");
        },
      }),
      null,
    );
  });

  it("captureCanvasFrame accepts a valid data URL", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(
      captureCanvasFrame({ width: 4, height: 4, toDataURL: () => url }),
      url,
    );
  });

  it("show/hide freeze on a host element", () => {
    const g = globalThis as any;
    const prevDoc = g.document;
    g.document = {
      createElement(tag: string) {
        const attrs: Record<string, string> = {};
        const el: any = {
          tagName: tag.toUpperCase(),
          style: { cssText: "" },
          hidden: false,
          draggable: false,
          alt: "",
          src: "",
          parentNode: null,
          setAttribute(k: string, v: string) { attrs[k] = v; },
          getAttribute(k: string) { return attrs[k] ?? null; },
          remove() {
            const p = el.parentNode;
            if (!p) return;
            const ix = p.children.indexOf(el);
            if (ix >= 0) p.children.splice(ix, 1);
            el.parentNode = null;
          },
        };
        return el;
      },
    };
    try {
      const host = makeHost();
      const url =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const img = showLastFrameFreeze(host, url);
      assert.ok(img);
      assert.equal(img?.getAttribute(LAST_FRAME_ATTR), "1");
      assert.equal(hasLastFrameFreeze(host), true);
      assert.equal(findLastFrameEl(host), img);
      const img2 = showLastFrameFreeze(host, url);
      assert.equal(host.children.length, 1);
      assert.equal(img2, img);
      hideLastFrameFreeze(host);
      assert.equal(hasLastFrameFreeze(host), false);
      assert.equal(host.children.length, 0);
    } finally {
      if (prevDoc === undefined) delete g.document;
      else g.document = prevDoc;
    }
  });
});

import {
  CONTEXT_LOSS_MSG_FAILED,
  CONTEXT_LOSS_MSG_PAUSED,
  CONTEXT_LOSS_OVERLAY_ATTR,
  hideContextLossOverlay,
  showContextLossOverlay,
} from "./last-frame-freeze.ts";

describe("context-loss overlay Gap#59", () => {
  it("shows honest paused copy and upgrades to failed+retry", () => {
    const g = globalThis as any;
    const prevDoc = g.document;
    const children: any[] = [];
    const host: any = {
      children,
      appendChild(el: any) {
        children.push(el);
        el.parentNode = host;
        return el;
      },
      querySelector(sel: string) {
        if (sel.includes(CONTEXT_LOSS_OVERLAY_ATTR) || sel.includes("dash3d-ctx-loss")) {
          return children.find((c) => c.getAttribute?.(CONTEXT_LOSS_OVERLAY_ATTR) === "1") ?? null;
        }
        const root = children[0];
        if (!root?.querySelector) return null;
        return root.querySelector(sel);
      },
    };
    g.document = {
      createElement(tag: string) {
        const attrs: Record<string, string> = {};
        const kids: any[] = [];
        const el: any = {
          tagName: tag.toUpperCase(),
          style: { cssText: "", display: "" },
          hidden: false,
          textContent: "",
          className: "",
          type: "",
          onclick: null as null | (() => void),
          children: kids,
          parentNode: null,
          setAttribute(k: string, v: string) { attrs[k] = String(v); },
          getAttribute(k: string) { return attrs[k] ?? null; },
          appendChild(c: any) { kids.push(c); c.parentNode = el; return c; },
          querySelector(sel: string) {
            const wantMsg = sel.includes("dash3d-ctx-loss-msg");
            const wantRetry = sel.includes("dash3d-ctx-loss-retry");
            const walk = (nodes: any[]): any => {
              for (const k of nodes) {
                const tid = k.getAttribute?.("data-testid");
                if (wantMsg && tid === "dash3d-ctx-loss-msg") return k;
                if (wantRetry && tid === "dash3d-ctx-loss-retry") return k;
                const hit = walk(k.children ?? []);
                if (hit) return hit;
              }
              return null;
            };
            if (wantMsg || wantRetry) return walk(kids);
            if (sel.includes(CONTEXT_LOSS_OVERLAY_ATTR)) return attrs[CONTEXT_LOSS_OVERLAY_ATTR] === "1" ? el : null;
            return null;
          },
          remove() {
            const p = el.parentNode;
            if (!p) return;
            const ix = p.children.indexOf(el);
            if (ix >= 0) p.children.splice(ix, 1);
            el.parentNode = null;
          },
        };
        return el;
      },
    };
    try {
      const lost = showContextLossOverlay(host, "lost");
      assert.ok(lost);
      const msg = lost!.querySelector('[data-testid="dash3d-ctx-loss-msg"]');
      assert.equal(msg?.textContent, CONTEXT_LOSS_MSG_PAUSED);
      let retried = 0;
      showContextLossOverlay(host, "failed", { onRetry: () => { retried += 1; } });
      const retry = lost!.querySelector('[data-testid="dash3d-ctx-loss-retry"]') as any;
      assert.equal(msg?.textContent, CONTEXT_LOSS_MSG_FAILED);
      assert.equal(retry.style.display, "inline-flex");
      retry.onclick?.();
      assert.equal(retried, 1);
      hideContextLossOverlay(host);
      assert.equal(host.children.length, 0);
    } finally {
      g.document = prevDoc;
    }
  });
});
