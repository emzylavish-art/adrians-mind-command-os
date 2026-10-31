import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMemory,
  createChat,
  emptyWorkspace,
  memoriesForChat,
  mergeWorkspace,
  packWorkspace,
  unpackWorkspace,
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
});
