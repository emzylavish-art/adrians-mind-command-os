import assert from "node:assert/strict";
import { test } from "node:test";
import { indexKnowledgeDocument, knowledgeDatabaseName, knowledgeReadiness, normalizeKnowledgePassages, retrieveKnowledge, updateKnowledgeIndex, type KnowledgeDocument } from "./knowledge-index.ts";
import { normalizeBotKnowledge } from "./bot-model.ts";
import { addCustomAgent, readFleet } from "./fleet.ts";
import { emptyWorkspace, normalizeWorkspace, openBotChat } from "./workspace.ts";

function document(id: string, text: string, projectId: string | null = null): KnowledgeDocument { return { id, ownerId: "owner", projectId, title: `${id}.txt`, text, revision: `v1-${id}`, sourceModifiedAt: "2026-11-26T00:00:00Z" }; }

test("a 50,000-character original knowledge document is preserved and its tail is retrievable", () => {
  const text = "General operating procedure. ".repeat(1800) + "\nAmberfjord recovery requires the blue ledger.\n";
  assert.ok(text.length > 50000);
  assert.equal(normalizeBotKnowledge(text).knowledge, text.trim());
  const indexed = indexKnowledgeDocument(document("manual", text), "owner");
  const result = retrieveKnowledge({ ownerId: "owner", documents: [indexed] }, { ownerId: "owner", projectId: null, documentIds: ["manual"], query: "What does Amberfjord recovery require?" });
  assert.ok(result.passages.some((passage) => passage.quote.includes("blue ledger")));
  for (const passage of result.passages) assert.equal(text.slice(passage.start, passage.end), passage.quote);
  assert.equal(normalizeBotKnowledge("a".repeat(100001)).knowledge, ""); assert.match(normalizeBotKnowledge("a".repeat(100001)).rejected, /not truncated/);
});

test("indexing hundreds of documents updates one and deletes one without rebuilding unchanged records", () => {
  const source = Array.from({ length: 300 }, (_, i) => document(`doc-${i}`, `Reference ${i} about marine projects.`));
  const initial = updateKnowledgeIndex({ ownerId: "owner", documents: [] }, "owner", source).index;
  const changed = { ...source[10], revision: "v2", text: "Amberfjord updated requirement." };
  const result = updateKnowledgeIndex(initial, "owner", [changed], ["doc-11"]);
  assert.deepEqual(result.indexedIds, ["doc-10"]); assert.deepEqual(result.removedIds, ["doc-11"]);
  assert.equal(result.index.documents.find((item) => item.id === "doc-9"), initial.documents.find((item) => item.id === "doc-9"));
  assert.equal(result.index.documents.length, 299);
  const query = retrieveKnowledge(result.index, { ownerId: "owner", projectId: null, documentIds: ["doc-10", "doc-11"], query: "Amberfjord" });
  assert.equal(query.passages[0].revision, "v2"); assert.deepEqual(query.omittedDocumentIds, ["doc-11"]);
});

test("local retrieval enforces account, selected-document, and project boundaries", () => {
  const index = updateKnowledgeIndex({ ownerId: "owner", documents: [] }, "owner", [document("global", "project key alpha"), document("one", "project key bravo", "one"), document("two", "project key charlie", "two")]).index;
  assert.deepEqual(retrieveKnowledge(index, { ownerId: "foreign", projectId: "one", documentIds: ["global", "one", "two"], query: "project key" }).passages, []);
  const result = retrieveKnowledge(index, { ownerId: "owner", projectId: "one", documentIds: ["one", "two"], query: "project key" });
  assert.deepEqual(result.passages.map((passage) => passage.documentId), ["one"]);
  assert.throws(() => indexKnowledgeDocument(document("a", "x"), "foreign"), /another account/);
  assert.notEqual(knowledgeDatabaseName("owner"), knowledgeDatabaseName("other"));
});

test("readiness distinguishes local, partial, and missing references without claiming remote synchronization", () => {
  const full = indexKnowledgeDocument(document("full", "release instructions"), "owner");
  const partial = indexKnowledgeDocument({ ...document("partial", "preview only"), partial: true }, "owner");
  const states = knowledgeReadiness({ ownerId: "owner", documents: [full, partial] }, ["full", "partial", "remote"]);
  assert.deepEqual(states.map((entry) => entry.status), ["ready-local", "partial-local", "not-on-this-device"]);
});

test("passage normalization rejects forged range shape and bounds context without changing source", () => {
  const base = { documentId: "d", documentTitle: "D", revision: "v1", start: 10, end: 15, quote: "exact", projectId: null, authority: "owner-approved" };
  assert.equal(normalizeKnowledgePassages([base]).length, 1);
  assert.deepEqual(normalizeKnowledgePassages([{ ...base, end: 16 }]), []);
  assert.deepEqual(normalizeKnowledgePassages([base], 4), []);
});

test("agent knowledge references persist, copy into new bot chats, and remain isolated from old conversations", () => {
  const result = addCustomAgent(emptyWorkspace(), { name: "Knowledge", instructions: "Read references.", tools: ["list_projects"], knowledgeDocumentIds: ["doc-a", "doc-b"] });
  assert.equal(result.ok, true); if (!result.ok) return;
  const ws = normalizeWorkspace(result.ws);
  assert.deepEqual(readFleet(ws).agents[0].knowledgeDocumentIds, ["doc-a", "doc-b"]);
  const chat = openBotChat(ws, result.agent.id);
  assert.deepEqual(chat?.chat.knowledgeDocumentIds, ["doc-a", "doc-b"]);
});
