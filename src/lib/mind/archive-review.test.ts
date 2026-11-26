import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { archiveReview, packMemoryOnly, unpackMemoryOnly, quarantineImportedMemory, resolveImportedMemory, unreviewedMemoryScopeIds } from "./archive-review.ts";
import { addMemory, canonical, createChat, emptyWorkspace, memoriesForChat, mergeWorkspace, normalizeWorkspace, packWorkspace, replaceFromArchive, sha256, unpackWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";

function fixture(): Workspace {
  const created = createChat(emptyWorkspace(), { memory: "on", autonomy: "ask", temporary: false, projectId: "project-a" });
  const ws = addMemory(created.ws, { scope: "global", text: "NOTE_MARKER", source: "fixture", projectId: null, chatId: null });
  ws.projects = [{ id: "project-a", name: "Scope A", description: "PROJECT_BODY_MARKER", createdAt: "2026-01-01T00:00:00Z" }];
  ws.chats[0].messages = [{ id: "message-a", role: "user", content: "CHAT_BODY_MARKER", at: "2026-01-01T00:00:00Z" }];
  ws.files = [{ id: "file-a", name: "fixture.txt", text: "FILE_BODY_MARKER", bytes: 16, createdAt: "2026-01-01T00:00:00Z", projectId: "project-a" }];
  ws.audit = [{ id: "audit-a", action: "fixture", target: "fixture", result: "ACTIVITY_MARKER", at: "2026-01-01T00:00:00Z" }];
  return ws;
}

describe("C5 archive transfer privacy and conflict contracts", () => {
  it("exports only notes and scope labels while keeping full workspace backup intact", async () => {
    let ws = fixture();
    ws = addMemory(ws, { scope: "project", text: "PROJECT_NOTE_MARKER", source: "fixture", projectId: "project-a", chatId: null });
    ws = addMemory(ws, { scope: "chat", text: "CHAT_NOTE_MARKER", source: "fixture", projectId: null, chatId: ws.chats[0].id });
    const packed = await packMemoryOnly(ws);
    const json = JSON.stringify(packed);
    for (const marker of ["NOTE_MARKER", "PROJECT_NOTE_MARKER", "CHAT_NOTE_MARKER"]) assert.ok(json.includes(marker));
    for (const marker of ["CHAT_BODY_MARKER", "FILE_BODY_MARKER", "PROJECT_BODY_MARKER", "ACTIVITY_MARKER"]) assert.ok(!json.includes(marker));
    assert.deepEqual(packed.data.scopes.projects, [{ id: "project-a", name: "Scope A" }]);
    const full = JSON.stringify(await packWorkspace(ws, true));
    for (const marker of ["CHAT_BODY_MARKER", "FILE_BODY_MARKER", "PROJECT_BODY_MARKER", "ACTIVITY_MARKER"]) assert.ok(full.includes(marker));
    const decoded = await unpackMemoryOnly(json, ws);
    assert.equal(decoded.ok, true);
    if (decoded.ok) assert.equal(decoded.workspace.memories.length, 3);
  });
  it("defaults matching and new imported conversations to safe memory preferences, with explicit restore opt-in", () => {
    const archive = fixture();
    const current = structuredClone(archive);
    current.chats[0].memory = "off";
    const newChat = createChat(archive, { memory: "on", autonomy: "ask", temporary: false, projectId: null }).chat;
    archive.chats.push(newChat);
    assert.deepEqual(archiveReview(current, archive).privacy.map(x => x.id).sort(), archive.chats.map(x => x.id).sort());
    for (const merge of [mergeWorkspace, replaceFromArchive]) {
      const safe = merge(current, archive);
      assert.ok(safe.chats.every(chat => chat.memory === "off"));
      assert.ok(safe.chats.every(chat => memoriesForChat(safe, chat).length === 0));
      assert.ok(merge(current, archive, true).chats.every(chat => chat.memory === "on"));
    }
  });
  it("previews record conflicts and keeps newer local project/file/agent/schedule records during Merge", () => {
    const current = fixture();
    current.agents = [{ id: "agent", name: "new agent" }] as Workspace["agents"];
    current.schedules = [{ id: "schedule", instruction: "new task" }] as Workspace["schedules"];
    const old = structuredClone(current);
    old.projects[0].description = "old description"; old.files[0].text = "old file";
    old.agents[0].name = "old agent"; old.schedules[0].instruction = "old task";
    assert.deepEqual(archiveReview(current, old).conflicts.map(x => x.category).sort(), ["agents", "files", "projects", "schedules"]);
    const merged = mergeWorkspace(current, old);
    assert.equal(merged.projects[0].description, "PROJECT_BODY_MARKER");
    assert.equal(merged.files[0].text, "FILE_BODY_MARKER"); assert.equal(merged.agents[0].name, "new agent"); assert.equal(merged.schedules[0].instruction, "new task");
  });
  it("quarantines unresolved and undeclared scopes even after manual unarchive, until explicitly resolved", async () => {
    const destination = fixture();
    const incoming = normalizeWorkspace({ ...emptyWorkspace(), memories: [
      { id: "missing-project", scope: "project", projectId: "not-there", text: "private project note" },
      { id: "missing-chat", scope: "chat", chatId: "not-there", text: "private chat note" },
      { id: "legacy", text: "legacy scope must be reviewed" },
    ] });
    const checked = quarantineImportedMemory(incoming, destination, new Set(["legacy"]));
    assert.ok(checked.memories.every(note => note.archived && note.reviewReason));
    const joined = mergeWorkspace(destination, checked);
    joined.memories = joined.memories.map(note => ({ ...note, archived: false }));
    assert.deepEqual(memoriesForChat(joined, joined.chats[0]).map(note => note.text), ["NOTE_MARKER"]);
    assert.equal(resolveImportedMemory(joined, "missing-project", "project", "not-there"), joined);
    const resolved = resolveImportedMemory(joined, "missing-project", "project", "project-a");
    assert.ok(memoriesForChat(resolved, resolved.chats[0]).some(note => note.id === "missing-project"));
    assert.equal(resolved.memories.find(note => note.id === "missing-project")?.scope, "project");
  });
  it("rechecks associations for Replace because current-only destinations disappear", () => {
    const current = fixture();
    const incoming = addMemory(emptyWorkspace(), { scope: "project", text: "project-only", source: "fixture", projectId: "project-a", chatId: null });
    const mergePreview = quarantineImportedMemory(incoming, current);
    assert.equal(mergePreview.memories[0].reviewReason, undefined);
    const replacePreview = quarantineImportedMemory(mergePreview, emptyWorkspace());
    const replaced = replaceFromArchive(current, replacePreview);
    assert.equal(replaced.projects.length, 0);
    assert.ok(replaced.memories[0].reviewReason); assert.equal(replaced.memories[0].scope, "project");
  });
  it("accepts unchanged legacy full-workspace integrity and quarantines missing scope only at import review", async () => {
    const raw = { ...emptyWorkspace(), memories: [{ id: "legacy", text: "old note", scope: undefined }] };
    const normalized = normalizeWorkspace(raw);
    const archive = JSON.stringify({ product: "adrians-mind", format: 1, sha256: await sha256(canonical(normalized)), workspace: raw });
    const result = await unpackWorkspace(archive);
    assert.equal(result.ok, true);
    if (result.ok) {
      const quarantined = quarantineImportedMemory(result.workspace, emptyWorkspace(), new Set(["legacy"]));
      assert.ok(quarantined.memories[0].reviewReason);
    }
  });
  it("rejects a changed memory-only archive without importing its records", async () => {
    const packed = await packMemoryOnly(fixture());
    packed.data.memories[0].text = "tampered";
    assert.equal((await unpackMemoryOnly(JSON.stringify(packed), emptyWorkspace())).ok, false);
  });
  it("rejects unsupported scopes and quarantines undeclared scopes before global retrieval", async () => {
    const data = { memories: [{ id: "bad-scope", text: "PRIVATE_SCOPE_MARKER", scope: "legacy-project" }, { id: "missing-scope", text: "UNDECLARED_SCOPE_MARKER" }], scopes: { projects: [], chats: [] } };
    const archive = { product: "adrians-mind-memory", format: 1, data, sha256: await sha256(canonical(data)) };
    assert.deepEqual([...unreviewedMemoryScopeIds(data.memories)], ["bad-scope", "missing-scope"]);
    const current = fixture();
    const result = await unpackMemoryOnly(JSON.stringify(archive), current);
    assert.ok(result.ok);
    if (result.ok) {
      const merged = mergeWorkspace(current, result.workspace);
      assert.ok(!merged.memories.some(note => note.id === "bad-scope"));
      assert.ok(merged.memories.find(note => note.id === "missing-scope")?.reviewReason);
      assert.ok(!memoriesForChat(merged, merged.chats[0]).some(note => note.id === "bad-scope" || note.id === "missing-scope"));
    }
  });
});
