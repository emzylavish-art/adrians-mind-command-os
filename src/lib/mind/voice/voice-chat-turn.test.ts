import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyWorkspace, createChat } from "../workspace.ts";
import { createCallHistory, buildVoiceChatTurn, pcm16MonoDurationMs } from "./voice-chat-turn.ts";

describe("voice chat turn", () => {
  it("builds user + assistant messages for the thread", () => {
    let n = 0;
    const turn = buildVoiceChatTurn({
      userText: "  What time is it? ",
      assistantText: "It is about noon.",
      nowIso: "2026-11-01T15:00:00.000Z",
      idFactory: () => `id-${++n}`,
    });
    assert.ok(turn);
    assert.equal(turn!.user.content, "What time is it?");
    assert.equal(turn!.assistant.content, "It is about noon.");
    assert.equal(turn!.user.role, "user");
    assert.equal(turn!.assistant.role, "assistant");
  });

  it("rejects empty sides", () => {
    assert.equal(buildVoiceChatTurn({ userText: "", assistantText: "x" }), null);
  });

  it("computes PCM16 mono duration from byte count", () => {
    // 0.8s at 24kHz = 19200 samples = 38400 bytes
    assert.equal(pcm16MonoDurationMs(38400, 24000), 800);
    assert.equal(pcm16MonoDurationMs(0, 24000), 0);
  });
});

describe("session-scoped call history", () => {
  it("materializes only on a transcript, uses one thread across renders and never revives a deleted conversation", () => {
    const start = emptyWorkspace();
    let created = 0;
    const record = createCallHistory(null, () => {
      created++;
      return createChat(start, { autonomy: "ask", memory: "off", temporary: true, projectId: null }).chat;
    });
    assert.equal(created, 0);
    const user = { id: "u", at: "now", role: "user" as const, content: "Hello" };
    const spoken = { id: "a", at: "now", role: "assistant" as const, content: "Hi", model: "local-test", provider: "ollama" };
    const first = record(user);
    const second = record(spoken);
    const ws = second(first(start));
    assert.equal(created, 1);
    assert.equal(ws.chats.length, 1);
    assert.deepEqual(ws.chats[0].messages, [user, spoken]);
    assert.equal(ws.chats[0].temporary, true);
    assert.deepEqual(second(start), start);
  });
});
