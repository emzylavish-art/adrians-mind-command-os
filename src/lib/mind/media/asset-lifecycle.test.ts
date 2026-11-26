import { test } from "node:test";
import assert from "node:assert/strict";
import { identifyImages, prepareMediaExport, validateCreativeParameters } from "./asset-lifecycle.ts";
import { compactImageRefs, hydrateImageRefs, createMemoryBlobStore } from "./blob-store.ts";

test("editing retains immutable parent identity through offload, hydration, and export", async () => {
  const original = "data:image/png;base64," + "A".repeat(90000);
  const edited = "data:image/png;base64," + "B".repeat(90000);
  const [parent] = await identifyImages([{ dataUrl: original }]);
  const [child] = await identifyImages([{ dataUrl: edited }], { parent: original, operationId: "operation-123", editPrompt: "New lighting" });
  assert.notEqual(parent.assetId, child.assetId);
  assert.equal(child.parentAssetId, parent.assetId);
  const store = createMemoryBlobStore();
  const refs = await compactImageRefs([parent, child], store);
  assert.equal(refs[1].dataUrl, undefined);
  const hydrated = await hydrateImageRefs(refs, store);
  assert.equal(hydrated[1].editPrompt, "New lighting");
  assert.equal(hydrated[1].parentAssetId, parent.assetId);
  assert.equal(hydrated[0].dataUrl, original);
});

test("portable exports include stored pixels and identify missing and temporary assets", async () => {
  const source = { chats: [{ id: "chat", messages: [{ id: "message", images: [{ blobId: "present" }, { blobId: "missing" }], videoUrl: "https://video.example/temporary" }] }] };
  const result = await prepareMediaExport(source, createMemoryBlobStore({ present: "data:image/png;base64,AA==" }));
  assert.deepEqual(result.assets.map((row) => row.availability), ["included", "missing", "external-temporary"]);
  assert.equal(result.complete, false);
  assert.equal((result.workspace.chats[0].messages[0].images[0] as { dataUrl?: string }).dataUrl, "data:image/png;base64,AA==");
  assert.equal((source.chats[0].messages[0].images[0] as { dataUrl?: string }).dataUrl, undefined);
});

test("only implemented image counts and video durations are accepted", () => {
  assert.equal(validateCreativeParameters({ kind: "image", count: 4 }), null);
  assert.equal(validateCreativeParameters({ kind: "video", duration: 15 }), null);
  for (const count of [0, 5, 1.5, NaN]) assert.ok(validateCreativeParameters({ kind: "image", count }));
  for (const duration of [0, 16, 2.5, NaN]) assert.ok(validateCreativeParameters({ kind: "video", duration }));
});
