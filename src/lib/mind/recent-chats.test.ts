import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Chat } from "./types";
import { getRecentChats } from "./recent-chats.ts";

function chat(id: string, stamps: string[] = []): Chat {
  return {
    id,
    title: id,
    memory: "off",
    temporary: false,
    autonomy: "ask",
    projectId: null,
    messages: stamps.map((at, index) => ({ id: `${id}-${index}`, role: "user", content: "", at })),
    retrievalLog: [],
  };
}

describe("getRecentChats", () => {
  it("orders actual chat activity by the newest message, retaining stable ties", () => {
    const source = [chat("older", ["2026-11-05T10:00:00Z"]), chat("newer", ["2026-11-05T11:00:00Z"]), chat("tie", ["2026-11-05T11:00:00Z"]), chat("empty")];
    assert.deepEqual(getRecentChats(source).map(({ id }) => id), ["newer", "tie", "older", "empty"]);
    assert.deepEqual(source.map(({ id }) => id), ["older", "newer", "tie", "empty"]);
  });

  it("uses the latest message in a chat and ignores invalid timestamps", () => {
    const source = [chat("invalid", ["not-a-date"]), chat("multi", ["2026-11-05T10:00:00Z", "2026-11-05T12:00:00Z"])];
    assert.deepEqual(getRecentChats(source).map(({ id }) => id), ["multi", "invalid"]);
  });

  it("omits pinned chats so they are not duplicated in the recent list", () => {
    const source = [chat("pinned", ["2026-11-05T12:00:00Z"]), chat("recent", ["2026-11-05T11:00:00Z"]), chat("older", ["2026-11-05T10:00:00Z"])];
    assert.deepEqual(getRecentChats(source, 5, new Set(["pinned"])).map(({ id }) => id), ["recent", "older"]);
  });

  it("honors a finite positive limit and returns none for invalid limits", () => {
    const source = [chat("a"), chat("b"), chat("c")];
    assert.deepEqual(getRecentChats(source, 2).map(({ id }) => id), ["a", "b"]);
    assert.deepEqual(getRecentChats(source, 0), []);
    assert.deepEqual(getRecentChats(source, Number.POSITIVE_INFINITY), []);
  });
});
