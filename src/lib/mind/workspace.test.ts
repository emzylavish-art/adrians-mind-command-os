import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMemory,
  canonical,
  createChat,
  emptyWorkspace,
  memoriesForChat,
  mergeWorkspace,
  normalizeWorkspace,
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
});

describe("normalizeChat media images (V5-B4)", () => {
  it("preserves validated images[] (dataUrl + blobId) across normalizeWorkspace", () => {
    const ws = normalizeWorkspace({
      version: 1,
      chats: [
        {
          id: "c1",
          title: "Media",
          memory: "off",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "hi",
              at: "2020-01-01T00:00:00.000Z",
              images: [
                { dataUrl: "data:image/png;base64,aaa", name: "shot.png", blobId: "img_c1_abc" },
                { dataUrl: "javascript:alert(1)", name: "evil" },
              ],
            },
          ],
        },
      ],
    });
    const images = ws.chats[0]?.messages[0]?.images;
    assert.equal(images?.length, 1);
    assert.equal(images?.[0]?.blobId, "img_c1_abc");
    assert.equal(images?.[0]?.dataUrl, "data:image/png;base64,aaa");
    assert.equal(images?.[0]?.name, "shot.png");
  });

  it("keeps blobId-only compact refs without inventing pixels", () => {
    const ws = normalizeWorkspace({
      version: 1,
      chats: [
        {
          id: "c2",
          title: "Compact",
          messages: [
            {
              id: "m2",
              role: "assistant",
              content: "done",
              at: "2020-01-01T00:00:00.000Z",
              images: [{ blobId: "img_c2_xyz", name: "generated-1.png", mime: "image/png" }],
            },
          ],
        },
      ],
    });
    const images = ws.chats[0]?.messages[0]?.images;
    assert.equal(images?.length, 1);
    assert.equal(images?.[0]?.blobId, "img_c2_xyz");
    assert.equal(images?.[0]?.dataUrl, undefined);
  });
});
