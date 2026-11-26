import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHistoryMessages, prepareHistoryContext, selectHistoryForQuestion, type HistoryInputMessage } from "./history.ts";
import { assembleTurn } from "../prompt.ts";
import { chatTurnBody } from "../logic-routes.ts";
const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const user = (name: string): HistoryInputMessage => ({ id: name, role: "user", content: name, images: [{ dataUrl: TINY, name }] });

describe("C2 historical image continuity", () => {
  it("AA-069 retrieves bounded older exact-topic turns while retaining chronological order", () => {
    const history: HistoryInputMessage[] = [
      { id: "evidence", role: "user", content: "Harbor dredging allowance is 14 feet." },
      ...Array.from({ length: 18 }, (_, index) => ({ id: `recent-${index}`, role: "assistant" as const, content: `unrelated reply ${index}` })),
    ];
    const selected = selectHistoryForQuestion(history, "What was the harbor dredging allowance?");
    assert.equal(selected.messages.length, 12);
    assert.equal(selected.messages[0]?.id, "evidence");
    assert.equal(selected.messages.at(-1)?.id, "recent-17");
    assert.equal(selected.retrievedTextCount, 1);
    assert.deepEqual(selectHistoryForQuestion(history, "Please explain what happened").messages, history.slice(-12));
    assert.deepEqual(selectHistoryForQuestion(history, "harbor").messages, history.slice(-12));
  });

  it("AA-069 lexical matches cannot displace explicitly referenced images", () => {
    const history: HistoryInputMessage[] = [user("first.png"), { role: "user", content: "harbor dredging allowance" }, ...Array.from({ length: 14 }, () => ({ role: "assistant" as const, content: "recent" }))];
    const selected = selectHistoryForQuestion(history, "Compare first.png and the harbor dredging allowance", 1);
    assert.equal(selected.messages.length, 1);
    assert.equal(selected.messages[0], history[0]);
    assert.equal(selected.retrievedTextCount, 0);
  });

  it("AA-114 selects an explicit old image within the same 12-message limit", () => {
    const first = user("floor-plan.png");
    const history: HistoryInputMessage[] = [first, ...Array.from({ length: 15 }, (_, index) => ({ role: "assistant" as const, content: `answer ${index}` }))];
    const selected = selectHistoryForQuestion(history, "Compare floor-plan.png with the new layout", 12);
    assert.equal(selected.messages.length, 12);
    assert.equal(selected.messages[0], first);
    assert.equal(selected.messages.at(-1), history.at(-1));
    assert.deepEqual(selected.referencedNames, ["floor-plan.png"]);
    assert.equal(selectHistoryForQuestion(history, "Explain the first image", 12).messages[0], first);
  });

  it("AA-114 named images take priority over unrelated recent images", () => {
    const prepared = prepareHistoryContext([user("old.png"), user("new.png"), user("other.png")], "Read old.png", { maxImages: 1 });
    assert.deepEqual(prepared.included.map((image) => image.name), ["old.png"]);
    assert.equal(prepared.omitted.length, 2);
    assert.match(prepared.messages[1]!.content, /not included in this request/);
  });

  it("AA-115 fits individual images instead of dropping an entire group", () => {
    const group = { ...user("a"), images: ["a", "b", "c"].map((name) => ({ dataUrl: TINY, name })) };
    const prepared = prepareHistoryContext([group], "", { maxImages: 2, maxImageChars: TINY.length * 2 });
    assert.equal(prepared.included.length, 2);
    assert.equal(prepared.omitted.length, 1);
    assert.match(prepared.messages[0]!.content, /1 of this turn's 3 images/);
    assert.match(prepared.warnings[0]!, /must not claim to see omitted/);
  });

  it("unavailable blob-only references are disclosed without invented image bytes", () => {
    const prepared = prepareHistoryContext([{ role: "user", content: "file", images: [{ name: "lost.png" }] }], "Read lost.png");
    assert.equal(prepared.included.length, 0);
    assert.equal(prepared.omitted[0]!.reason, "unavailable");
    assert.equal(prepared.messages[0]!.images, undefined);
  });

  it("AA-116 preserves assistant image origin using a user-role vision reference", () => {
    const messages = buildHistoryMessages([{ role: "assistant", content: "Generated plan", images: [{ dataUrl: TINY, name: "plan.png", origin: "generated" }] }]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, "assistant");
    assert.equal(messages[0]!.content, "Generated plan");
    assert.equal(messages[1]!.role, "user");
    assert.ok(Array.isArray(messages[1]!.content));
    assert.match(JSON.stringify(messages[1]!.content), /preceding assistant response/);
    assert.match(JSON.stringify(messages[1]!.content), /image_url/);
  });

  it("text-only routes do not receive historical images or claim they were seen", () => {
    const assembled = assembleTurn({ text: "Describe old.png", memory: "off", memoryContext: [], history: [user("old.png")], allowHistoryImages: false });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;
    assert.doesNotMatch(JSON.stringify(assembled.messages), /data:image/);
    assert.match(JSON.stringify(assembled.messages), /selected provider does not accept historical images/);
  });

  it("subtracts current-turn payload from the historical image allowance", () => {
    const prepared = prepareHistoryContext([user("old.png")], "", { maxImageChars: TINY.length - 1 });
    assert.equal(prepared.included.length, 0);
    assert.equal(prepared.omitted[0]!.reason, "budget");
  });

  it("AA-115 the actual request body skips one oversized image while retaining a fitting sibling", () => {
    const huge = { name: "large.png", dataUrl: "data:image/png;base64," + "a".repeat(1_600_000) };
    const small = { name: "small.png", dataUrl: TINY };
    const current = { name: "current.png", dataUrl: "data:image/png;base64," + "b".repeat(980_000) };
    const history = [{ role: "user", content: "A saved pair", images: [small, huge] }];
    const body = chatTurnBody({ text: "Read small.png", memory: "off", halted: false, history, memoryContext: [], provider: "gemini", modelTier: "Auto", logicRoute: null, images: [current] });
    const sent = body.history as typeof history;
    assert.deepEqual(sent[0]!.images, [small]);
    assert.match(sent[0]!.content, /large.png not included/);
    assert.deepEqual(body.historyImageOmissions, [{ messageIndex: 0, name: "large.png", reason: "request_body_budget" }]);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 2_500_000);
    assert.deepEqual(body.images, [current]);
    assert.equal(history[0]!.images.length, 2);
  });
});
