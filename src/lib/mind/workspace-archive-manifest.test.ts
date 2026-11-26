import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceArchiveManifest } from "./workspace-archive-manifest.ts";
import { describePersistence } from "./persistence.ts";
import { emptyWorkspace, mergeWorkspace, packWorkspace, unpackWorkspace, replaceFromArchive } from "./workspace.ts";
import { addAgentFromTemplate, addSchedule, enqueueRun, runDueSchedules, tickFleet } from "./fleet.ts";

const NOW = "2026-11-25T12:00:00.000Z";
describe("C2 backup coverage and storage identity", () => {
  it("AA-132/135 distinguishes file storage from RAM without claiming production restart evidence", () => {
    const local = describePersistence(undefined);
    assert.equal(local.storageKind, "local-file");
    assert.equal(local.backend, "memory"); // compatibility with old clients
    assert.equal(local.restartChecked, false);
    assert.equal(local.cloudBackup, false);
    assert.equal(describePersistence("postgres://fixture.invalid/mind").storageKind, "remote-postgres");
  });

  it("AA-136 enumerates actual archive collections and unavailable media bytes", async () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
    if (!made.ok) throw new Error(made.error);
    const added = addSchedule(made.ws, "Fixture", made.agent.id, 60, NOW);
    if (!added.ok) throw new Error(added.error);
    const queued = enqueueRun(added.ws, made.agent.id, "List projects", NOW);
    if (!queued.ok) throw new Error(queued.error);
    const ws = queued.ws;
    ws.deletedFileIds = ["deleted-file"];
    ws.deletedMemoryIds = ["deleted-note"];
    ws.chats = [{ id: "saved", title: "Saved", memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [{ id: "image", role: "assistant", at: NOW, content: "Image reference", images: [{ blobId: "unportable-fixture", name: "result.png", origin: "generated" }], videoUrl: "https://example.invalid/video" }] }, { id: "temporary", title: "Temporary", memory: "off", temporary: true, autonomy: "ask", projectId: null, retrievalLog: [], messages: [] }];
    const packed = await packWorkspace(ws, false);
    const manifest = workspaceArchiveManifest(packed.workspace, { omittedTemporaryChats: 1 });
    assert.equal(manifest.collections.chats, 1);
    assert.equal(manifest.collections.agents, 1);
    assert.equal(manifest.collections.schedules, 1);
    assert.equal(manifest.collections.deletedFileIds, 1);
    assert.equal(manifest.media.blobReferencesWithoutBytes, 1);
    assert.equal(manifest.media.fullyPortable, false);
    assert.equal(manifest.authenticity, "not-established");
    assert.match(manifest.excluded.join(" "), /OAuth credentials/);
    assert.match(manifest.excluded.join(" "), /temporary conversations/);
    const decoded = await unpackWorkspace(JSON.stringify(packed));
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    const restored = replaceFromArchive(emptyWorkspace(), decoded.workspace);
    assert.equal(restored.schedules[0]!.enabled, false);
    assert.equal(restored.runs[0]!.state, "paused");
    assert.deepEqual(restored.runs[0]!.approvedActions, []);
  });

  it("AA-136 restores the declared workspace categories while preserving safe execution state", async () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
    if (!made.ok) throw new Error(made.error);
    const ws = made.ws;
    ws.projects = [{ id: "project", name: "Harbor", description: "Fixture", createdAt: NOW }];
    ws.memories = [{ id: "memory", scope: "project", projectId: "project", chatId: null, text: "Corrected", source: "fixture", createdAt: NOW, updatedAt: NOW, archived: false, versions: [{ at: NOW, text: "Earlier" }] }];
    ws.deletedMemoryIds = ["removed-memory"];
    ws.deletedFileIds = ["removed-file"];
    ws.files = [{ id: "file", name: "record.txt", text: "Saved source", bytes: 12, projectId: "project", createdAt: NOW }];
    ws.chats = [{ id: "chat", title: "Review", projectId: "project", memory: "on", autonomy: "ask", temporary: false, messages: [{ id: "message", role: "assistant", content: "Recorded", at: NOW, provider: "Fixture", model: "test-model" }], retrievalLog: [{ at: NOW, ids: ["memory"] }] }];
    ws.pins = [{ id: "pin", kind: "chat", ref: "chat" }];
    ws.usage = [{ id: "usage", chatId: "chat", at: NOW, model: "test-model", requestId: "fixture-request", promptTokens: 10, completionTokens: 5, kind: "actual" }];
    ws.audit = [{ id: "audit", at: NOW, action: "fixture", target: "chat", result: "verified synthetic" }];
    ws.recovery = [{ id: "recovery", at: NOW, action: "notion_operation", target: "notion", message: "Check the existing operation", state: "open", operationId: "operation", workspaceId: "workspace", chatId: "chat" }];
    ws.connections = [{ id: "connection", provider: "openai", label: "Fixture label", status: "unconfigured", secretStored: false }];
    ws.mailboxes = [{ id: "mailbox", label: "Fixture mailbox", address: "fixture@example.invalid", status: "not_connected" }];
    ws.browserSessions = [{ id: "browser", runId: null, url: "https://example.invalid", title: "Fixture read", status: "closed", lastAction: "Read only", excerpt: "Evidence", updatedAt: NOW }];
    const packed = await packWorkspace(ws, false);
    assert.equal(packed.manifest.collections.recoveryRecords, 1);
    const unpacked = await unpackWorkspace(JSON.stringify(packed));
    assert.equal(unpacked.ok, true);
    if (!unpacked.ok) return;
    const restored = replaceFromArchive(emptyWorkspace(), unpacked.workspace);
    for (const key of ["projects", "files", "chats", "pins", "usage", "connections", "mailboxes", "browserSessions", "recovery"] as const) {
      assert.equal(restored[key]?.length, 1, `${key} survives archive restore`);
    }
    assert.equal(restored.memories[0]?.text, "Corrected");
    assert.equal(restored.memories[0]?.versions[0]?.text, "Earlier");
    assert.deepEqual(restored.deletedFileIds, ["removed-file"]);
    assert.deepEqual(restored.deletedMemoryIds, ["removed-memory"]);
    assert.equal(restored.chats[0]?.messages[0]?.provider, "Fixture");
    assert.equal(packed.manifest.media.fullyPortable, true);
    assert.equal(packed.manifest.authenticity, "not-established");
  });

  it("AA-028/051 archive import cannot grant or redirect conversation result delivery", () => {
    const made = addAgentFromTemplate(emptyWorkspace(), "Coding", NOW);
    if (!made.ok) throw new Error(made.error);
    const schedule = addSchedule(made.ws, "Local inventory", made.agent.id, 60, NOW);
    if (!schedule.ok) throw new Error(schedule.error);
    let current = schedule.ws;
    current.chats = ["original", "other"].map((id) => ({ id, title: id, memory: "off" as const, temporary: false, autonomy: "ask" as const, projectId: null, messages: [], retrievalLog: [] }));
    current.schedules[0]!.chatId = "original";
    current = runDueSchedules(current, NOW);
    current.runs[0] = { ...current.runs[0]!, state: "completed", result: "Fixture completed output" };
    const archive = structuredClone(current);
    archive.schedules[0]!.resultDelivery = "conversation";
    archive.schedules[0]!.chatId = "other";
    const env = { now: NOW, workerId: "fixture" };
    for (const restored of [replaceFromArchive(emptyWorkspace(), archive), mergeWorkspace(emptyWorkspace(), archive), mergeWorkspace(current, archive)]) {
      const advanced = tickFleet(restored, env);
      assert.equal(advanced.schedules[0]!.resultDelivery, "runs");
      assert.equal(advanced.chats.reduce((sum, chat) => sum + chat.messages.length, 0), 0);
    }
    current.schedules[0]!.resultDelivery = "conversation";
    const merged = mergeWorkspace(current, archive);
    assert.equal(merged.schedules[0]!.chatId, "original");
    const delivered = tickFleet(merged, env);
    assert.equal(delivered.chats.find((chat) => chat.id === "original")!.messages.length, 1);
    assert.equal(delivered.chats.find((chat) => chat.id === "other")!.messages.length, 0);
  });
});
