import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEditableImage, imageEditLineage } from "./image-reference.ts";
import { compactImageRefs, createMemoryBlobStore, hydrateImageRefs } from "./blob-store.ts";
import { imagePreparationProfile } from "./image-metadata.ts";
import { fitWithinBox } from "./data-url.ts";
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=";

test("embedded and account-authorized stored image references resolve through the same validated editor", async () => {
  let reads = 0;
  const context = { ownerId: "a", currentOwner: () => "a", authorizedImages: [{ blobId: "img-a" }], getOwnedBlob: async () => { reads++; return image; } };
  const inline = await resolveEditableImage({ ...context, source: image });
  const stored = await resolveEditableImage({ ...context, source: { blobId: "img-a" } });
  assert.equal(inline.ok, true); assert.equal(stored.ok, true); assert.equal(reads, 1);
  assert.equal((await resolveEditableImage({ ...context, source: { blobId: "foreign" } })).ok, false); assert.equal(reads, 1);
  assert.equal((await resolveEditableImage({ ...context, source: "https://private.example/image" })).ok, false); assert.equal(reads, 1);
  assert.equal((await resolveEditableImage({ ...context, currentOwner: () => "b", source: image })).ok, false);
});
test("edits preserve parent/root references and preparation receipts through compaction", async () => {
  const resolved = await resolveEditableImage({ source: image, ownerId: "a", currentOwner: () => "a", authorizedImages: [], getOwnedBlob: async () => undefined });
  assert.equal(resolved.ok, true); if (!resolved.ok) return;
  const edits = [1, 2, 3].map(index => ({ dataUrl: image, lineage: imageEditLineage(resolved.image, `Edit${index}`, "actual", "2026-01-01T00:00:00Z", `edit-${index}`) }));
  const store = createMemoryBlobStore();
  const restored = await hydrateImageRefs(await compactImageRefs(edits, store), store);
  assert.equal(new Set(restored.map(item => item.lineage?.imageId)).size, 3);
  assert.ok(restored.every(item => item.lineage?.parentImageId === resolved.image.imageId && item.lineage.rootImageId === resolved.image.imageId));
});
test("preparation quality exposes resolution tradeoffs while respecting adapter edge limits", () => {
  const saver = imagePreparationProfile("data-saver"), detail = imagePreparationProfile("high-detail", 4096);
  assert.deepEqual(fitWithinBox(3840, 2160, saver.maxEdge), { width: 1024, height: 576, scaled: true });
  assert.deepEqual(fitWithinBox(3840, 2160, detail.maxEdge), { width: 3840, height: 2160, scaled: false });
  assert.equal(imagePreparationProfile("high-detail").maxEdge, 2048);
  assert.ok(detail.jpegQualities[0] > saver.jpegQualities[0]);
});
