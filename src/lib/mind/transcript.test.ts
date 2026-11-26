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

  it("exports one chat as JSON without inventing sources and keeps images", () => {
    const ws = sample();
    ws.chats[0]!.messages[0] = {
      ...ws.chats[0]!.messages[0]!,
      images: [{ dataUrl: "data:image/png;base64,aa", name: "kept.png" }],
    };
    const packed = exportChat(ws, "c1");
    assert.equal("error" in packed, false);
    if ("error" in packed) return;
    assert.equal(packed.filename, "chat-c1.json");
    const parsed = JSON.parse(packed.json) as {
      chat: { messages: { content: string; images?: { dataUrl: string; name?: string | null }[] }[] };
    };
    assert.equal(parsed.chat.messages.length, 3);
    assert.equal(packed.json.includes("http"), false);
    assert.equal(parsed.chat.messages[0]?.images?.[0]?.name, "kept.png");
    assert.match(parsed.chat.messages[0]?.images?.[0]?.dataUrl ?? "", /^data:image\/png;base64,/);
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

describe("conversation lineage and reply alternatives", () => {
  it("rejects oversize edits without losing a trailing requirement", () => {
    const ws = sample();
    const text = "x".repeat(9000) + "FINAL_REQUIREMENT";
    const before = JSON.stringify(ws);
    const result = reviseUserTurn(ws, "c1", "u1", text);
    assert.ok("error" in result && /not been truncated/.test(result.error));
    assert.equal(JSON.stringify(ws), before);
  });

  it("branches at an exact message and strips pending delivery authority", async () => {
    const { createEditedBranch } = await import("./transcript.ts");
    const { normalizeWorkspace, sha256, canonical } = await import("./workspace.ts");
    const ws = sample();
    ws.chats[0].messages[2] = { ...ws.chats[0].messages[2], delivery: "unconfirmed", deliveryOperationId: "1760000000000-12345678-1234-1234-1234-123456789abc", partialReply: "incomplete", deliveryRoute: { provider: "grok", tier: "Fast", model: "grok", orchestrated: false, fingerprint: "a".repeat(64) } };
    const expected = await sha256(canonical(ws.chats[0]));
    const result = await createEditedBranch(ws, "c1", "u2", "Edited second");
    assert.ok(!("error" in result));
    if ("error" in result) return;
    const chat = normalizeWorkspace(result.ws).chats[0];
    assert.deepEqual(chat.branchFrom, { chatId: "c1", messageId: "u2", reason: "edit", createdAt: chat.branchFrom?.createdAt, sourceRevision: expected });
    assert.deepEqual(chat.messages[2].inheritedFrom, { chatId: "c1", messageId: "u2" });
    for (const message of chat.messages) {
      assert.equal(message.deliveryOperationId, undefined);
      assert.equal(message.deliveryRoute, undefined);
      assert.equal(message.delivery, undefined);
      assert.equal(message.partialReply, undefined);
    }
    assert.equal(chat.messages[1].model, "grok-4.5");
    assert.equal(ws.chats[0].messages[2].content, "Second");
  });

  it("retains three regenerated versions and continues from only the selected answer", async () => {
    const { withReplyVersion, selectReplyVersion } = await import("./transcript.ts");
    const { normalizeWorkspace } = await import("./workspace.ts");
    const ws = sample();
    let reply = ws.chats[0].messages[1];
    for (let i = 1; i <= 3; i++) reply = withReplyVersion(reply, { id: `v${i}`, role: "assistant", content: `Answer ${i}`, at: `2026-01-0${i}`, provider: `fixture-${i}` });
    ws.chats[0].messages[1] = reply;
    assert.equal(reply.replyVersions?.length, 4);
    const selected = normalizeWorkspace(selectReplyVersion(ws, "c1", "v3", "a1"));
    assert.equal(selected.chats[0].messages[1].content, "Answer");
    assert.equal(selected.chats[0].messages[1].model, "grok-4.5");
    assert.equal(selected.chats[0].messages[1].provider, undefined);
    assert.equal(selected.chats[0].messages[1].replyVersions?.length, 4);
    const packed = exportChat(selected, "c1");
    assert.ok(!("error" in packed));
    if ("error" in packed) return;
    const doc = JSON.parse(packed.json);
    assert.equal(doc.version, 2);
    assert.equal(doc.chat.messages[1].id, "v3");
    assert.equal(doc.chat.messages[1].replyVersions.length, 4);
    assert.equal(doc.exportKind, "structured-transcript");
    assert.ok(doc.limitations.some((line: string) => /Blob identifiers/.test(line)));
  });
});
