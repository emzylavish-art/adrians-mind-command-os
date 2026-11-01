import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "./transcript.ts";

function sample() {
  const ws = emptyWorkspace();
  ws.chats.push({
    id: "c1",
    title: "Old",
    memory: "off",
    temporary: false,
    autonomy: "ask",
    projectId: null,
    retrievalLog: [],
    messages: [
      { id: "u1", role: "user", content: "First", at: "2026-01-01T00:00:00.000Z" },
      { id: "a1", role: "assistant", content: "Answer", at: "2026-01-01T00:00:01.000Z", model: "grok-4.5" },
      { id: "u2", role: "user", content: "Second", at: "2026-01-01T00:00:02.000Z" },
    ],
  });
  return ws;
}

describe("transcript edits", () => {
  it("renames one chat and refuses a blank title", () => {
    const named = renameChat(sample(), "c1", "  Lake house  ");
    assert.equal(named?.chats[0]?.title, "Lake house");
    assert.equal(renameChat(sample(), "c1", "   "), null);
  });

  it("edits a user message and drops everything after it", () => {
    const revised = reviseUserTurn(sample(), "c1", "u1", "Rewritten");
    assert.equal("error" in revised, false);
    if ("error" in revised) return;
    assert.deepEqual(revised.chat.messages.map((msg) => msg.id), ["u1"]);
    assert.equal(revised.chat.messages[0]?.content, "Rewritten");
    assert.equal(revised.text, "Rewritten");
  });

  it("does not edit an assistant message", () => {
    const revised = reviseUserTurn(sample(), "c1", "a1", "No");
    assert.equal("error" in revised && revised.error, "Only your messages can be edited.");
  });

  it("drops only the last reply before a regenerate", () => {
    const ws = sample();
    ws.chats[0]?.messages.push({ id: "a2", role: "assistant", content: "Later", at: "2026-01-01T00:00:03.000Z" });
    const prepared = prepareRegenerate(ws, "c1");
    assert.equal("error" in prepared, false);
    if ("error" in prepared) return;
    assert.equal(prepared.text, "Second");
    assert.deepEqual(prepared.chat.messages.map((msg) => msg.id), ["u1", "a1", "u2"]);
  });

  it("retries the last user message without adding a copy", () => {
    const prepared = prepareRetry(sample(), "c1");
    assert.equal("error" in prepared, false);
    if ("error" in prepared) return;
    assert.equal(prepared.text, "Second");
    assert.equal(prepared.chat.messages.length, 3);
  });

  it("does not retry when the last message is a reply", () => {
    const ws = sample();
    ws.chats[0]?.messages.push({ id: "a2", role: "assistant", content: "Later", at: "2026-01-01T00:00:03.000Z" });
    const prepared = prepareRetry(ws, "c1");
    assert.equal("error" in prepared && prepared.error, "Use regenerate for the last reply.");
  });

  it("exports one chat as JSON without inventing sources", () => {
    const packed = exportChat(sample(), "c1");
    assert.equal("error" in packed, false);
    if ("error" in packed) return;
    assert.equal(packed.filename, "chat-c1.json");
    const parsed = JSON.parse(packed.json) as { chat: { messages: { content: string }[] } };
    assert.equal(parsed.chat.messages.length, 3);
    assert.equal(packed.json.includes("http"), false);
  });


  it("retries and regenerates with the original image attachments", () => {
    const ws = sample();
    const chat = ws.chats[0]!;
    chat.messages = [
      {
        id: "u1",
        role: "user",
        content: "what color?\n\n[Attached: red.png]",
        at: "2026-01-01T00:00:00.000Z",
        images: [{ dataUrl: "data:image/png;base64,aa", name: "red.png" }],
      },
      { id: "a1", role: "assistant", content: "red", at: "2026-01-01T00:00:01.000Z", model: "grok-4.5" },
    ];
    const regen = prepareRegenerate(ws, "c1");
    assert.equal("error" in regen, false);
    if ("error" in regen) return;
    assert.equal(regen.text, "what color?");
    assert.equal(regen.images.length, 1);
    assert.equal(regen.images[0]?.name, "red.png");

    const retryWs = { ...ws, chats: [{ ...chat, messages: chat.messages.slice(0, 1) }] };
    const retry = prepareRetry(retryWs, "c1");
    assert.equal("error" in retry, false);
    if ("error" in retry) return;
    assert.equal(retry.images[0]?.dataUrl, "data:image/png;base64,aa");
  });

});
