import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCameraMirrorTransform,
  moveAttachmentIndex,
  nextLightboxZoom,
  prevLightboxZoom,
  removeAttachmentIndexes,
  safeImageDownloadName,
  toggleIndexSelection,
} from "./media-ui-helpers.ts";
import {
  cycleDownscaleQuality,
  downscaleOptionsFor,
  loadDownscaleQuality,
  parseDownscaleQuality,
  saveDownscaleQuality,
} from "./downscale-quality.ts";

describe("lightbox zoom steps", () => {
  it("cycles forward through 100% → 150% → 200% → 300% → 100%", () => {
    assert.equal(nextLightboxZoom(1), 1.5);
    assert.equal(nextLightboxZoom(1.5), 2);
    assert.equal(nextLightboxZoom(2), 3);
    assert.equal(nextLightboxZoom(3), 1);
  });

  it("cycles backward and tolerates unknown current values", () => {
    assert.equal(prevLightboxZoom(1), 3);
    assert.equal(prevLightboxZoom(1.5), 1);
    assert.equal(prevLightboxZoom(2), 1.5);
    assert.equal(prevLightboxZoom(3), 2);
    assert.equal(nextLightboxZoom(9), 1);
    assert.equal(prevLightboxZoom(9), 1);
  });
});

describe("camera mirror transform", () => {
  it("mirrors horizontally when enabled and is a no-op when disabled", () => {
    const calls: Array<{ op: string; args: number[] }> = [];
    const ctx = {
      translate: (x: number, y: number) => calls.push({ op: "translate", args: [x, y] }),
      scale: (x: number, y: number) => calls.push({ op: "scale", args: [x, y] }),
    };
    applyCameraMirrorTransform(ctx, 640, false);
    assert.deepEqual(calls, []);
    applyCameraMirrorTransform(ctx, 640, true);
    assert.deepEqual(calls, [
      { op: "translate", args: [640, 0] },
      { op: "scale", args: [-1, 1] },
    ]);
  });
});

describe("attachment reorder and multi-remove", () => {
  it("moves items left/right without mutating the source", () => {
    const src = ["a", "b", "c"];
    assert.deepEqual(moveAttachmentIndex(src, 1, -1), ["b", "a", "c"]);
    assert.deepEqual(moveAttachmentIndex(src, 0, -1), ["a", "b", "c"]);
    assert.deepEqual(moveAttachmentIndex(src, 2, 1), ["a", "b", "c"]);
    assert.deepEqual(moveAttachmentIndex(src, 0, 1), ["b", "a", "c"]);
    assert.deepEqual(src, ["a", "b", "c"]);
  });

  it("removes selected indexes and toggles selection sets", () => {
    assert.deepEqual(removeAttachmentIndexes(["a", "b", "c", "d"], [1, 3]), ["a", "c"]);
    assert.deepEqual(removeAttachmentIndexes(["a"], []), ["a"]);
    const selected = toggleIndexSelection(new Set([0]), 2);
    assert.deepEqual([...selected].sort(), [0, 2]);
    assert.deepEqual([...toggleIndexSelection(selected, 0)].sort(), [2]);
  });
});

describe("safe download filenames", () => {
  it("rejects chat/prompt text and keeps machine stems", () => {
    const png = "data:image/png;base64,xx";
    const jpg = "data:image/jpeg;base64,xx";
    assert.match(safeImageDownloadName(png, "camera-123"), /^camera-123\.png$/);
    assert.match(safeImageDownloadName(jpg, "saved-photo.jpg"), /^saved-photo\.jpg$/);
    assert.match(safeImageDownloadName(jpg, "A long prompt about a red fox in snow"), /^amcos-image-[a-z0-9]+\.jpg$/);
    assert.match(safeImageDownloadName(png, "/imagine paint a castle at dusk"), /^amcos-image-[a-z0-9]+\.png$/);
    assert.match(safeImageDownloadName(png, null), /^amcos-image-[a-z0-9]+\.png$/);
  });
});

describe("downscale quality presets", () => {
  it("parses, cycles, and persists Fast/Balanced/Full", () => {
    assert.equal(parseDownscaleQuality("fast"), "fast");
    assert.equal(parseDownscaleQuality("nope"), "balanced");
    assert.equal(cycleDownscaleQuality("fast"), "balanced");
    assert.equal(cycleDownscaleQuality("balanced"), "full");
    assert.equal(cycleDownscaleQuality("full"), "fast");
    assert.equal(downscaleOptionsFor("fast").maxEdge, 1280);
    assert.equal(downscaleOptionsFor("balanced").maxEdge, 2048);
    assert.ok(downscaleOptionsFor("full").jpegQualities[0]! >= 0.9);

    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    saveDownscaleQuality("full", storage);
    assert.equal(loadDownscaleQuality(storage), "full");
  });
});
