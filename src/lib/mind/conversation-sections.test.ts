import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationSection, groupConversationSections, hideSection, readHiddenSections, removeConversations, restoreSection } from "./conversation-sections.ts";

const now = new Date("2026-11-21T12:00:00Z");
function daysBefore(days: number) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function chat(id: string, at?: string) {
  return { id, title: id, messages: at ? [{ at }] : [] };
}

describe("conversation sections", () => {
  it("keeps missing and same-day chats in Today", () => {
    assert.equal(conversationSection(chat("empty"), now), "Today");
    assert.equal(conversationSection(chat("today", daysBefore(0)), now), "Today");
    assert.equal(conversationSection(chat("yesterday", daysBefore(1)), now), "Yesterday");
    assert.equal(conversationSection(chat("week", daysBefore(3)), now), "This week");
    assert.equal(conversationSection(chat("old", daysBefore(20)), now), "Earlier");
  });

  it("drops empty sections and keeps the category order", () => {
    const groups = groupConversationSections([
      chat("old", daysBefore(20)),
      chat("today", daysBefore(0)),
    ], now);
    assert.deepEqual(groups.map((group) => group.label), ["Today", "Earlier"]);
  });

  it("removes the chosen chats and their pins only", () => {
    const next = removeConversations({
      chats: [chat("keep"), chat("gone")],
      pins: [
        { kind: "chat", ref: "gone" },
        { kind: "chat", ref: "keep" },
        { kind: "project", ref: "gone" },
      ],
    }, ["gone"]);
    assert.deepEqual(next.chats.map((item) => item.id), ["keep"]);
    assert.deepEqual(next.pins, [
      { kind: "chat", ref: "keep" },
      { kind: "project", ref: "gone" },
    ]);
  });

  it("hides a section and can restore it", () => {
    assert.deepEqual(readHiddenSections("not json"), []);
    assert.deepEqual(hideSection(["Account"], "Account"), ["Account"]);
    assert.deepEqual(restoreSection(hideSection([], "Connections"), "Connections"), []);
  });
});
