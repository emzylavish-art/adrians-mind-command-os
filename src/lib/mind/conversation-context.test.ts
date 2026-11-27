import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateConversationContext, contextBudget, estimateTextTokens, extractRelevantPassages, normalizeCheckpoints } from "./conversation-context.ts";
import { assembleTurn } from "./prompt.ts";
import { checkTurnSize } from "./limits.ts";
import { buildHistoryWithReceipt } from "./media/history.ts";
import { chatTurnBody } from "./logic-routes.ts";

const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a decision near the beginning of a hundred-message conversation reaches context", () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" as const : "user" as const, content: i === 0 ? "Approved decision: Release destination is Harbor, never the Delta workspace." : `Routine discussion ${i}. ${"Unrelated detail. ".repeat(80)}` }));
  const result = assembleTurn({ history, text: "Continue the release using our approved destination.", memory: "off", memoryContext: [], contextOptions: { maxInputTokens: 6000 } });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.match(JSON.stringify(result.messages), /Release destination is Harbor/);
  assert.ok(result.contextReceipt.history.some((entry) => entry.id === "m0" && entry.state !== "omitted"));
  assert.ok(result.contextReceipt.history.some((entry) => entry.state === "omitted"));
  assert.equal(history[0].content, "Approved decision: Release destination is Harbor, never the Delta workspace.");
});

test("a 20,000-character prior reply can be continued without modifying the original", () => {
  const content = "a".repeat(19000) + "\nCorrection: The target table is archive_v2.\n" + "b".repeat(1000);
  const history = [{ id: "long", role: "assistant" as const, content }];
  assert.equal(checkTurnSize({ text: "Continue with archive_v2.", history, memoryContext: [] }).ok, true);
  const result = assembleTurn({ history, text: "Continue with archive_v2.", memory: "off", memoryContext: [], contextOptions: { maxInputTokens: 6000 } });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.match(JSON.stringify(result.messages), /archive_v2/); assert.equal(history[0].content, content);
  assert.equal(result.contextReceipt.history[0].state, "excerpted");
});

test("declared model capacity and output reserve change allocation and unknown capacity stays explicit", () => {
  const small = contextBudget({ model: "fixture-small", contextWindowTokens: 8192, outputTokens: 2048 });
  const large = contextBudget({ model: "fixture-large", contextWindowTokens: 32768, outputTokens: 4096 });
  assert.equal(small.capacity, "declared"); assert.ok(small.inputTokenBudget < large.inputTokenBudget);
  assert.equal(contextBudget({ model: "unknown" }).capacity, "conservative-default");
  const allocation = allocateConversationContext([{ id: "cjk", role: "user", content: "漢字".repeat(3000) }], "漢字", { contextWindowTokens: 8192, outputTokens: 2048 });
  assert.ok(allocation.receipt.estimatedTextTokens <= small.inputTokenBudget);
  assert.equal(estimateTextTokens("漢字"), 6);
});

test("extractive checkpoints preserve contradictory decisions, corrections, and open tasks as separate records", () => {
  const history = [
    { id: "a", role: "user" as const, content: "Decision: Ship Thursday." },
    { id: "b", role: "user" as const, content: "Correction: Thursday was wrong; ship Friday.\nUnresolved: Confirm the final workspace." },
  ];
  const result = allocateConversationContext(history, "continue shipping", { maxInputTokens: 6000 });
  assert.match(result.checkpointText, /Ship Thursday/); assert.match(result.checkpointText, /ship Friday/); assert.match(result.checkpointText, /Unresolved/);
  assert.equal(result.receipt.checkpoints.length, 3); assert.ok(result.receipt.checkpoints.every((entry) => entry.sourceMessageIds.length === 1));
  assert.equal(normalizeCheckpoints([{ id: "x", kind: "decision", text: "fact", sourceMessageIds: ["missing"], state: "active", origin: "owner" }], new Set(["a"])).length, 0);
});

test("two authorized assistant-generated historical images are packaged for compatible input", () => {
  const result = buildHistoryWithReceipt([{ id: "generated", role: "assistant", content: "Two generated variations.", images: [{ dataUrl: IMAGE, name: "left.png" }, { dataUrl: IMAGE, name: "right.png" }] }], { query: "Compare left.png and right.png" });
  assert.equal(result.receipt.filter((image) => image.included).length, 2);
  assert.equal(result.messages[0].role, "assistant"); assert.equal(result.messages[1].role, "user");
  assert.ok(Array.isArray(result.messages[1].content));
  const blocked = buildHistoryWithReceipt([{ id: "generated", role: "assistant", content: "Two images", images: [{ dataUrl: IMAGE, name: "left.png" }] }], { supportsImages: false });
  assert.equal(blocked.receipt[0].included, false); assert.match(blocked.receipt[0].reason!, /support-unavailable/);
});

test("an explicit old image beats recency and omitted images have reasons", () => {
  const history = Array.from({ length: 4 }, (_, i) => ({ id: `image-${i}`, role: "user" as const, content: `image ${i}`, images: [{ dataUrl: IMAGE, name: `image-${i}.png` }] }));
  const result = buildHistoryWithReceipt(history, { maxImages: 2, selectedImageMessageIds: ["image-0"] });
  assert.equal(result.receipt.find((entry) => entry.messageId === "image-0")?.included, true);
  assert.equal(result.receipt.filter((entry) => !entry.included).length, 2);
  const byName = buildHistoryWithReceipt(history, { maxImages: 1, query: "Compare image-0.png" });
  assert.equal(byName.receipt.find((entry) => entry.included)?.messageId, "image-0");
});

test("client body retains original history and the behavior controls for server allocation", () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: "user", content: `Turn ${i}` }));
  const body = chatTurnBody({ text: "Continue", history, memory: "off", memoryContext: [], halted: false, provider: "grok", modelTier: "Auto", modelControls: { answerTokens: 4096 }, previousTier: "Heavy", logicRoute: null, images: [], projectInstructions: "Use project scope." });
  assert.equal((body.history as unknown[]).length, 100); assert.deepEqual(body.modelControls, { answerTokens: 4096 }); assert.equal(body.previousTier, "Heavy"); assert.equal(body.projectInstructions, "Use project scope.");
});

test("long bot knowledge retains and retrieves a passage near its end with source ranges", () => {
  const text = "Generic procedure. ".repeat(2800) + "\nAmberfjord release key: use the east staging dock.\n";
  const passage = extractRelevantPassages(text, "What is the Amberfjord release key?", 3000);
  assert.ok(passage.partial); assert.match(passage.text, /east staging dock/);
  for (const range of passage.ranges) assert.ok(passage.text.includes(text.slice(range.start, range.end)));
  const result = assembleTurn({ memory: "off", memoryContext: [], history: [], text: "What is the Amberfjord release key?", botKnowledge: text });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.match(String(result.messages[0].content), /east staging dock/); assert.ok(result.contextReceipt.knowledge!.some((entry) => entry.end > 40000));
  assert.equal(text.length > 50000, true);
});

test("project instructions are explicit saved context and excluded while chat memory is off", () => {
  const result = assembleTurn({ memory: "off", memoryContext: [], history: [], text: "Hello", projectInstructions: "PRIVATE_PROJECT_MARKER" });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.doesNotMatch(JSON.stringify(result.messages), /PRIVATE_PROJECT_MARKER/); assert.equal(result.contextReceipt.projectInstructions, "memory-off");
});
