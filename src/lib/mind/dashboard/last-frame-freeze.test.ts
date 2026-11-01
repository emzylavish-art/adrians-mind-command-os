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
