import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactImageCanBeUsed, artifactSourceIsCurrent, completedCodeArtifacts, listGeneratedArtifacts, prepareArtifactDocument, resolveArtifactImage, saveGeneratedArtifact } from "./generated-artifacts.ts";
import { createChat, emptyWorkspace } from "./workspace.ts";
import { readVerifiedOriginal, type OriginalFileStore } from "./library-documents.ts";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function fixture() {
  const created = createChat(emptyWorkspace(), { memory: "off", temporary: false, autonomy: "ask", projectId: "p" });
  created.chat.title = "Artifacts";
  created.chat.messages = [{ id: "user", role: "user", content: "Create something", at: "2026-11-26T00:00:00Z", partialReply: "```js\nUNFINISHED\n```" }, { id: "answer", role: "assistant", content: "Complete answer\n```typescript\nconst answer = 42;\n```", at: "2026-11-26T00:01:00Z", model: "fixture-model", images: [{ blobId: "image-ref", name: "result.png", origin: "generated" }], videoUrl: "https://example.invalid/temp-video.mp4" }];
  return { ...created, workspace: { ...created.ws, chats: [created.chat] } };
}
function originalStore(): OriginalFileStore { const rows = new Map<string, Blob>(); return { put: async (id, blob) => { rows.set(id, blob); }, get: async (id) => rows.get(id), remove: async (id) => { rows.delete(id); }, clear: async () => { rows.clear(); } }; }

test("artifact list links actual completed sources, excludes partial fragments and temporary chats", () => {
  const { workspace, chat } = fixture();
  workspace.chats.push({ ...chat, id: "temporary", temporary: true });
  const artifacts = listGeneratedArtifacts(workspace);
  assert.deepEqual(artifacts.map((item) => item.kind).sort(), ["code", "document", "image", "video"]);
  assert.ok(artifacts.every((item) => item.messageId === "answer" && item.chatId === chat.id));
  assert.doesNotMatch(JSON.stringify(artifacts), /UNFINISHED/);
  assert.equal(listGeneratedArtifacts(workspace, { kind: "image", projectId: "p" }).length, 1);
  assert.equal(listGeneratedArtifacts(workspace, { projectId: "other" }).length, 0);
  assert.equal(completedCodeArtifacts("```js\nnot closed").length, 0);
});

test("retained answer alternatives keep their own artifacts and never inherit the active answer's image", () => {
  const { workspace } = fixture();
  workspace.chats[0].messages[1].replyVersions = [{ id: "older", content: "Prior complete document", at: "2026-11-25T00:00:00Z" }];
  const older = listGeneratedArtifacts(workspace).filter((item) => item.replyVersionId === "older");
  assert.equal(older.length, 1); assert.equal(older[0].kind, "document"); assert.equal(older[0].model, undefined);
});

test("user attachments and camera assets remain discoverable without turning user text or partial replies into documents", () => {
  const { workspace } = fixture();
  workspace.chats[0].messages[0].images = [{ dataUrl: PIXEL, origin: "attached", name: "upload.png" }, { blobId: "camera-ref", origin: "camera", name: "camera.png" }];
  const assets = listGeneratedArtifacts(workspace).filter((artifact) => artifact.messageId === "user");
  assert.equal(assets.length, 2); assert.ok(assets.every((artifact) => artifact.kind === "image"));
  assert.doesNotMatch(JSON.stringify(assets), /UNFINISHED|Create something/);
});

test("image reuse resolves only the originating account store without creating new storage", async () => {
  const { workspace } = fixture();
  const artifact = listGeneratedArtifacts(workspace, { kind: "image" })[0];
  const reads: string[] = [];
  const image = await resolveArtifactImage(artifact, { ownerId: "owner", currentOwner: () => "owner", currentWorkspace: () => workspace, getOwned: async (id) => { reads.push(id); return PIXEL; } });
  assert.deepEqual(reads, ["image-ref"]); assert.equal(image.blobId, "image-ref"); assert.equal(image.dataUrl, PIXEL);
  assert.equal(image.messageId, "answer");
  await assert.rejects(resolveArtifactImage(artifact, { ownerId: "owner", currentOwner: () => "owner", currentWorkspace: () => workspace, getOwned: async () => undefined }), /unavailable/);
});

test("delayed image retrieval is rejected after an account change", async () => {
  let owner = "one";
  const { workspace } = fixture();
  const artifact = listGeneratedArtifacts(workspace, { kind: "image" })[0];
  await assert.rejects(resolveArtifactImage(artifact, { ownerId: "one", currentOwner: () => owner, currentWorkspace: () => workspace, getOwned: async () => { owner = "two"; return PIXEL; } }), /account changed/);
});

test("restoring another reply version rejects a delayed old image even when the artifact ID is unchanged", async () => {
  const { workspace } = fixture();
  const message = workspace.chats[0].messages[1];
  message.selectedReplyVersionId = "first";
  const oldArtifact = listGeneratedArtifacts(workspace, { kind: "image" })[0];
  let release!: (bytes: string) => void;
  const pendingBytes = new Promise<string>((resolve) => { release = resolve; });
  const pending = resolveArtifactImage(oldArtifact, { ownerId: "owner", currentOwner: () => "owner", currentWorkspace: () => workspace, getOwned: () => pendingBytes });
  message.images = [{ blobId: "restored-image", name: "restored.png", origin: "generated" }];
  message.selectedReplyVersionId = "restored";
  message.model = "restored-model";
  const restored = listGeneratedArtifacts(workspace, { kind: "image" })[0];
  assert.equal(restored.id, oldArtifact.id);
  release(PIXEL);
  await assert.rejects(pending, /source image changed/);
  assert.equal(artifactSourceIsCurrent(workspace, oldArtifact), false);
  const current = await resolveArtifactImage(restored, { ownerId: "owner", currentOwner: () => "owner", currentWorkspace: () => workspace, getOwned: async (id) => { assert.equal(id, "restored-image"); return PIXEL; } });
  assert.equal(artifactImageCanBeUsed(workspace, restored, current, "owner"), true);
  assert.equal(current.name, "restored.png");
});

test("cached previews cannot be edited or downloaded after inline bytes, selected version or owner changes", async () => {
  const { workspace } = fixture();
  const message = workspace.chats[0].messages[1];
  message.images = [{ dataUrl: PIXEL, name: "inline.png" }];
  message.selectedReplyVersionId = "first";
  const artifact = listGeneratedArtifacts(workspace, { kind: "image" })[0];
  const image = await resolveArtifactImage(artifact, { ownerId: "owner", currentOwner: () => "owner", currentWorkspace: () => workspace, getOwned: async () => { throw new Error("Inline bytes should not read a blob."); } });
  assert.equal(artifactImageCanBeUsed(workspace, artifact, image, "owner"), true);
  assert.equal(artifactImageCanBeUsed(workspace, artifact, image, "other-owner"), false);
  message.images = [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAWJVMogAAAAASUVORK5CYII=", name: "inline.png" }];
  assert.equal(artifactImageCanBeUsed(workspace, artifact, image, "owner"), false);
  message.images = [{ dataUrl: PIXEL, name: "inline.png" }];
  message.selectedReplyVersionId = "same-pixels-different-version";
  assert.equal(artifactImageCanBeUsed(workspace, artifact, image, "owner"), false);
  message.selectedReplyVersionId = "first";
  workspace.chats = [];
  assert.equal(artifactImageCanBeUsed(workspace, artifact, image, "owner"), false);
});

test("saving a large code artifact preserves exact original bytes, provenance and retained versions", async () => {
  const { workspace } = fixture();
  const code = "const value = '" + "x".repeat(60000) + "';\n";
  workspace.chats[0].messages[1].content = `\`\`\`typescript\n${code}\`\`\``;
  const artifact = listGeneratedArtifacts(workspace, { kind: "code" })[0];
  assert.equal(artifact.kind, "code"); if (artifact.kind !== "code") return;
  assert.equal(workspace.chats[0].messages[1].content.slice(artifact.sourceRange.start, artifact.sourceRange.end), code);
  const store = originalStore();
  const file = await prepareArtifactDocument(artifact, { ownerId: "owner", currentOwner: () => "owner", store });
  assert.equal(await (await readVerifiedOriginal(file, store)).text(), code); assert.equal(file.text.length, 40000); assert.equal(file.sourceMessageId, "answer");
  const first = saveGeneratedArtifact(workspace, file); assert.equal(first.ok, true); if (!first.ok) return;
  const again = saveGeneratedArtifact(first.workspace, file); assert.equal(again.ok, true); if (!again.ok) return;
  assert.equal(again.unchanged, true); assert.equal(again.workspace.files.length, 1);
  const changedFile = await prepareArtifactDocument({ ...artifact, text: "const value = 43;\n" }, { ownerId: "owner", currentOwner: () => "owner", store });
  const changed = saveGeneratedArtifact(again.workspace, changedFile); assert.equal(changed.ok, true); if (!changed.ok) return;
  assert.equal(changed.workspace.files.length, 1); assert.equal(changed.workspace.files[0].versions?.length, 1); assert.equal(changed.workspace.files[0].versions?.[0].original?.sha256, file.original?.sha256);
});
