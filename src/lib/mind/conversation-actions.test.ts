import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyArchive, applyFavorite, applyRename, conversationSharePath, quoteIntoNewChat, quoteText, scheduleConversation, visibleConversations } from "./conversation-actions.ts";
import { emptyWorkspace } from "./workspace.ts";
import type { Chat } from "./types.ts";

function chat(id: string, title = id): Chat {
  return {
    id,
    title,
    memory: "off",
    temporary: false,
    autonomy: "ask",
    projectId: null,
    messages: [{ id: "m", role: "user", content: "Keep this line", at: "2026-11-21T00:00:00.000Z" }],
    retrievalLog: [],
  };
}

describe("conversation actions", () => {
  it("copies a stable chat link", () => {
    assert.equal(conversationSharePath("chat-1", ["chat"]), "?section=chat&chat=chat-1");
  });

  it("favorites, archives, and hides the archived row", () => {
    const ws = { ...emptyWorkspace(), chats: [chat("a"), chat("b")] };
    const favored = applyFavorite(ws, ["a"], true);
    const archived = applyArchive(favored, ["a"], true);
    assert.equal(archived.chats[0]?.favorite, true);
    assert.equal(archived.chats[0]?.archived, true);
    assert.deepEqual(visibleConversations(archived.chats).map((item) => item.id), ["b"]);
  });

  it("renames one conversation and numbers a section", () => {
    const ws = { ...emptyWorkspace(), chats: [chat("a", "One"), chat("b", "Two")] };
    assert.equal(applyRename(ws, ["a"], "  Harbor  ")?.chats[0]?.title, "Harbor");
    const section = applyRename(ws, ["a", "b"], "Batch");
    assert.deepEqual(section?.chats.map((item) => item.title), ["Batch 1", "Batch 2"]);
    assert.equal(applyRename(ws, ["a"], "   "), null);
  });

  it("quotes the conversation into a new task without calling a model", () => {
    const source = chat("a", "Harbor");
    const opened = quoteIntoNewChat({ ...emptyWorkspace(), chats: [source] }, source);
    const created = opened.ws.chats.find((item) => item.id === opened.chatId);
    assert.equal(created?.title, "Quote: Harbor");
    assert.equal(created?.messages[0]?.content, quoteText(source));
    assert.equal(created?.messages.some((message) => message.role === "assistant"), false);
  });

  it("saves a schedule off and does not add a second copy", () => {
    const first = scheduleConversation(emptyWorkspace(), "Harbor");
    assert.equal(first.created, true);
    assert.equal(first.ws.schedules[0]?.enabled, false);
    const second = scheduleConversation(first.ws, "Harbor");
    assert.equal(second.created, false);
    assert.equal(second.ws.schedules.length, 1);
  });
});
