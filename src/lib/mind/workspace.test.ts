import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_LIBRARY_FILES } from "./knowledge-limits.ts";
import {
  addLocalFile,
  addMemory,
  canonical,
  createChat,
  deleteMemory,
  emptyWorkspace,
  clearedBrowserCopy,
  memoriesForChat,
  mergeWorkspace,
  normalizeWorkspace,
  packWorkspace,
  unpackWorkspace,
  updateChatPersonality,
  updateChatCustomPersonality,
} from "./workspace.ts";

describe("workspace memory", () => {
  it("starts memory off and does not write or retrieve", () => {
    const created = createChat(emptyWorkspace(), {
      memory: "off",
      autonomy: "ask",
      temporary: false,
      projectId: null,
    });
    assert.equal(created.chat.memory, "off");
    assert.equal(created.chat.autonomy, "ask");
    const withNotes = addMemory(created.ws, {
      scope: "global",
      text: "Lives in East Texas",
      source: "owner",
      projectId: null,
      chatId: null,
    });
    assert.equal(withNotes.memories.length, 1);
    assert.deepEqual(memoriesForChat(withNotes, created.chat), []);
    assert.equal(created.ws.memories.length, 0);
  });

  it("scopes retrieval when memory is on", () => {
    let ws = emptyWorkspace();
    const projectA = "project-a";
    const projectB = "project-b";
    ws.projects = [projectA, projectB].map((id) => ({ id, name: id, description: "", createdAt: "2026-01-01T00:00:00.000Z" }));
    const on = createChat(ws, { memory: "on", autonomy: "ask", temporary: false, projectId: projectA });
    ws = on.ws;
    const other = createChat(ws, { memory: "on", autonomy: "ask", temporary: false, projectId: projectB });
    ws = other.ws;
    ws = addMemory(ws, { scope: "global", text: "global", source: "owner", projectId: null, chatId: null });
    ws = addMemory(ws, { scope: "project", text: "project-a", source: "owner", projectId: projectA, chatId: null });
    ws = addMemory(ws, { scope: "project", text: "project-b", source: "owner", projectId: projectB, chatId: null });
    ws = addMemory(ws, { scope: "chat", text: "this-chat", source: "owner", projectId: null, chatId: on.chat.id });
    ws = addMemory(ws, { scope: "chat", text: "other-chat", source: "owner", projectId: null, chatId: other.chat.id });
    const archived = addMemory(ws, { scope: "global", text: "old", source: "owner", projectId: null, chatId: null });
    ws = {
      ...archived,
      memories: archived.memories.map((item, index) => (index === 0 ? { ...item, archived: true } : item)),
    };
    const texts = memoriesForChat(ws, on.chat).map((item) => item.text).sort();
    assert.deepEqual(texts, ["global", "project-a", "this-chat"]);
  });

  it("round-trips an archive and rejects tampering", async () => {
    const created = createChat(emptyWorkspace(), {
      memory: "off",
      autonomy: "automatic",
      temporary: true,
      projectId: null,
    });
    const packed = await packWorkspace(created.ws, false);
    assert.equal(packed.counts.chats, 0);
    const full = await packWorkspace(created.ws, true);
    const raw = JSON.stringify(full);
    const opened = await unpackWorkspace(raw);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal(opened.counts.chats, 1);
    const tampered = JSON.parse(raw) as { workspace: { halted: boolean }; sha256: string };
    tampered.workspace.halted = true;
    const rejected = await unpackWorkspace(JSON.stringify(tampered));
    assert.equal(rejected.ok, false);
  });

  it("merges by id without dropping the current chat", () => {
    const left = createChat(emptyWorkspace(), {
      memory: "off",
      autonomy: "ask",
      temporary: false,
      projectId: null,
    });
    const right = createChat(emptyWorkspace(), {
      memory: "on",
      autonomy: "ask",
      temporary: false,
      projectId: null,
    });
    const merged = mergeWorkspace(left.ws, right.ws);
    assert.equal(merged.chats.length, 2);
  });

  it("normalizes a realistic workspace inside the startup budget", () => {
    let ws = emptyWorkspace();
    for (let index = 0; index < 40; index += 1) {
      const made = createChat(ws, { memory: "off", autonomy: "ask", temporary: false, projectId: null });
      made.chat.messages = Array.from({ length: 8 }, (_, message) => ({
        id: `m-${index}-${message}`,
        role: message % 2 === 0 ? "user" : "assistant",
        content: "Lake note ".repeat(20),
        at: "2026-01-01T00:00:00.000Z",
      }));
      ws = made.ws;
    }
    const started = performance.now();
    const normalized = normalizeWorkspace(ws);
    const packed = canonical(normalized);
    const elapsed = performance.now() - started;
    assert.equal(normalized.chats.length, 40);
    assert.ok(packed.length > 10_000);
    assert.ok(elapsed < 200, `normalize and canonical took ${elapsed.toFixed(1)}ms`);
  });
  it("stores a personality per chat and defaults old workspace data safely", () => {
    const old = normalizeWorkspace({ chats: [{ id: "legacy", title: "Old chat", messages: [] }] });
    assert.equal(old.chats[0]?.personalityId, "assistant");
    const made = createChat(old, { memory: "off", autonomy: "ask", temporary: false, projectId: null, personalityId: "unhinged" });
    assert.equal(made.chat.personalityId, "unhinged");
    const next = updateChatPersonality(made.ws, made.chat.id, "custom");
    const customized = updateChatCustomPersonality(next, made.chat.id, "Candid, concise, analytical.");
    assert.equal(customized.chats.find((chat) => chat.id === made.chat.id)?.personalityId, "custom");
    assert.equal(customized.chats.find((chat) => chat.id === made.chat.id)?.customPersonality, "Candid, concise, analytical.");
    const invalid = updateChatPersonality(customized, made.chat.id, "unknown-mode");
    assert.equal(invalid.chats.find((chat) => chat.id === made.chat.id)?.personalityId, "assistant");
    assert.equal(invalid.chats.find((chat) => chat.id === made.chat.id)?.customPersonality, "Candid, concise, analytical.");
    const reloaded = normalizeWorkspace({ chats: [{ ...invalid.chats[0], customPersonality: "x".repeat(900) }] });
    assert.equal(reloaded.chats[0]?.customPersonality?.length, 800);
  });

  it("deleteMemory removes a note for real", () => {
    let ws = emptyWorkspace();
    ws = addMemory(ws, { scope: "global", text: "temp", source: "owner", projectId: null, chatId: null });
    const id = ws.memories[0]?.id;
    assert.ok(id);
    ws = deleteMemory(ws, id!);
    assert.equal(ws.memories.length, 0);
    ws = deleteMemory(ws, "missing");
    assert.equal(ws.memories.length, 0);
  });

  it("clears the browser copy and keeps the emergency stop", () => {
    const created = createChat({ ...emptyWorkspace(), halted: true }, {
      memory: "off",
      autonomy: "ask",
      temporary: false,
      projectId: null,
    });
    const cleared = clearedBrowserCopy({
      ...created.ws,
      agents: [{ id: "bot-1", name: "Harbor" } as never],
      files: [{ id: "file-1" } as never],
    });
    assert.equal(cleared.halted, true);
    assert.equal(cleared.chats.length, 0);
    assert.equal(cleared.files.length, 0);
    assert.equal(cleared.agents.length, 0);
    assert.equal(cleared.audit[0]?.action, "wipe_browser");
  });
});

describe("reply identity across provider switches", () => {
  it("keeps the provider and model of each completed turn when reopening a chat", () => {
    const saved = normalizeWorkspace({ chats: [{ id: "thread", messages: [
      { role: "assistant", content: "legacy", model: "legacy-model" },
      { role: "assistant", content: "one", provider: "First", model: "model-1" },
      { role: "assistant", content: "two", provider: "Second", model: "model unknown" },
    ] }] });
    const restored = normalizeWorkspace(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.chats[0].messages.map(({ provider, model }) => [provider, model]), [
      [undefined, "legacy-model"], ["First", "model-1"], ["Second", "model unknown"],
    ]);
  });
});

describe("library filenames", () => {
  it("preserves distinct long names and their text when reopening an archive", async () => {
    const prefix = "shared-filename-prefix-".repeat(7);
    const names = [prefix + "first.md", prefix + "second.csv"];
    let workspace = emptyWorkspace();
    for (const name of names) {
      workspace = addLocalFile(workspace, { name, text: "Contents of " + name, projectId: null });
    }

    const archive = await packWorkspace(workspace, false);
    const restored = await unpackWorkspace(JSON.stringify(archive));
    assert.ok(restored.ok);
    assert.deepEqual(
      restored.workspace.files.map(({ name, text }) => [name, text]).sort(),
      names.map((name) => [name, "Contents of " + name]).sort(),
    );
  });
});

it("merging an older archive twice retains newer turns and preserves local conflicting text", () => {
  const make = (entries: string[]) => normalizeWorkspace({ chats: [{ id: "thread", title: "Fixture", messages: entries.map((content, i) => ({
    id: String(i), role: "user", content, at: new Date(i * 1000).toISOString(),
  })) }] });
  const current = make(["corrected", "later"]);
  const old = make(["original"]);
  const merged = mergeWorkspace(mergeWorkspace(current, old), old);
  assert.deepEqual(merged.chats[0].messages.map((msg) => msg.content), ["corrected", "later"]);
  assert.equal(merged.chats.length, 1);
});

it("chat attachment copies cannot evict saved files at the Library capacity", () => {
  let workspace = emptyWorkspace();
  for (let i = 0; i < MAX_LIBRARY_FILES; i++) workspace = addLocalFile(workspace, { name: i + ".txt", text: "saved", projectId: null });
  assert.equal(addLocalFile(workspace, { name: "extra.txt", text: "turn only", projectId: null }), workspace);
});
