import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pullMindEvents } from "./stream.ts";
import { emptyWorkspace, createChat, addMemory, memoriesForChat, normalizeWorkspace } from "./workspace.ts";
import {
  injectableMemoriesForChat,
  memoryInjectionAllowed,
  memorySignalFromSave,
  emptyMemorySignal,
} from "./memory/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const commandApp = readFileSync(join(root, "components/mind/command-app.tsx"), "utf8");
const indicatorSrc = readFileSync(join(root, "components/mind/memory-saved-indicator.tsx"), "utf8");
const toggleSrc = readFileSync(join(root, "components/mind/memory-chat-toggle.tsx"), "utf8");

describe("memory UX mount in command-app", () => {
  it("imports and mounts MemorySavedIndicator + MemoryChatToggle", () => {
    for (const needle of [
      'from "@/components/mind/memory-saved-indicator"',
      'from "@/components/mind/memory-chat-toggle"',
      "<MemorySavedIndicator",
      "<MemoryChatToggle",
      'data-testid="memory-chat-toggle-header"',
      'data-testid="memory-chat-toggle-rail"',
      "onMemoryChange",
      "result.memorySaved === true",
      "msg.memorySaved === true",
    ]) {
      assert.match(commandApp, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("does not invent memorySaved when the turn did not save", () => {
    assert.deepEqual(emptyMemorySignal(), { memorySaved: false, savedMemoryId: null });
    assert.deepEqual(memorySignalFromSave({ ok: false }), { memorySaved: false, savedMemoryId: null });
    assert.equal(indicatorSrc.includes('if (!memorySaved) return null'), true);
  });

  it("SSE done carries memorySaved/savedMemoryId into the live-turn shape", () => {
    const sse = `event: done\ndata: ${JSON.stringify({
      text: "Noted.",
      model: "grok-4.5",
      usage: null,
      usedIds: ["m1"],
      requestId: "req-mem",
      memorySaved: true,
      savedMemoryId: "m1",
    })}\n\n`;
    const done = pullMindEvents(sse).events.find((event) => event.event === "done");
    assert.ok(done && done.event === "done");
    if (!done || done.event !== "done") return;
    assert.equal(done.memorySaved, true);
    assert.equal(done.savedMemoryId, "m1");
  });

  it("SSE done without save stays memorySaved false", () => {
    const sse = `event: done\ndata: ${JSON.stringify({
      text: "Hi",
      model: "grok-4.5",
      usage: null,
      usedIds: [],
      requestId: null,
    })}\n\n`;
    const done = pullMindEvents(sse).events.find((event) => event.event === "done");
    assert.ok(done && done.event === "done");
    if (!done || done.event !== "done") return;
    assert.equal(done.memorySaved, false);
    assert.equal(done.savedMemoryId, null);
  });

  it("MemoryChatToggle off skips prompt injection via existing helpers", () => {
    let ws = emptyWorkspace();
    const made = createChat(ws, { memory: "on", autonomy: "ask", temporary: false, projectId: null });
    ws = made.ws;
    ws = addMemory(ws, {
      scope: "global",
      text: "Owner prefers black and white UI",
      source: "test",
      projectId: null,
      chatId: null,
    });
    const onChat = ws.chats.find((chat) => chat.id === made.chat.id)!;
    assert.equal(memoryInjectionAllowed(onChat.memory), true);
    assert.equal(injectableMemoriesForChat(ws, onChat).length, 1);
    assert.equal(memoriesForChat(ws, onChat).length, 1);

    const offChat = { ...onChat, memory: "off" as const };
    assert.equal(memoryInjectionAllowed(offChat.memory), false);
    assert.deepEqual(injectableMemoriesForChat(ws, offChat), []);
    assert.deepEqual(memoriesForChat(ws, offChat), []);
  });

  it("persists memorySaved on assistant messages across normalizeWorkspace", () => {
    let ws = emptyWorkspace();
    const made = createChat(ws, { memory: "on", autonomy: "ask", temporary: false, projectId: null });
    ws = {
      ...made.ws,
      chats: made.ws.chats.map((chat) =>
        chat.id === made.chat.id
          ? {
              ...chat,
              messages: [
                {
                  id: "a1",
                  role: "assistant" as const,
                  content: "Saved.",
                  at: new Date().toISOString(),
                  model: "grok-4.5",
                  memorySaved: true,
                  savedMemoryId: "note-9",
                },
              ],
            }
          : chat,
      ),
    };
    const round = normalizeWorkspace(JSON.parse(JSON.stringify(ws)));
    const msg = round.chats.find((chat) => chat.id === made.chat.id)?.messages[0];
    assert.ok(msg);
    assert.equal(msg?.memorySaved, true);
    assert.equal(msg?.savedMemoryId, "note-9");
  });

  it("toggle control stays black/white (no purple accent classes)", () => {
    assert.equal(/bg-accent|text-accent|accent-ink/.test(toggleSrc), false);
    assert.match(toggleSrc, /aria-label=\{on \? "Memory on for this chat" : "Don't use memory for this chat"\}/);
    assert.match(toggleSrc, /role="switch"/);
  });
});
