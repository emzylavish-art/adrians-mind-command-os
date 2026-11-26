import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentDefinition, LocalFile, Workspace } from "./types.ts";
import { addLocalFile, addMemory, adoptBotConfiguration, botConversationRevision, createChat, deleteProject, emptyWorkspace, memoriesForChat, normalizeWorkspace, openBotChat, packWorkspace, setProjectArchived, sha256, unpackWorkspace, workspaceForChat } from "./workspace.ts";
import { documentCopyDisclosure, retrieveProjectPassages, validateProjectPassages } from "./knowledge.ts";
import { MAX_DOCUMENT_TEXT_CHARS } from "./knowledge-limits.ts";
import { validateMemoryDispatch } from "./memory/dispatch-policy.ts";
import { assembleTurn } from "./prompt.ts";

const at = "2026-01-01T00:00:00.000Z";
const project = { id: "project-a", name: "Project A", description: "", createdAt: at };
const localFile = (id: string, text: string, extra: Partial<LocalFile> = {}): LocalFile => ({ id, name: `${id}.txt`, text, bytes: text.length, projectId: project.id, createdAt: at, ...extra });
function setup() {
  const made = createChat({ ...emptyWorkspace(), projects: [project] }, { memory: "off", temporary: false, projectId: project.id, autonomy: "ask" });
  const chat = { ...made.chat, contextPolicy: { projectDocuments: true } };
  const workspace = { ...made.ws, chats: [chat], files: [localFile("one", "The Juniper launch is scheduled for September."), localFile("two", "Juniper owners need the release checklist."), localFile("foreign", "Juniper private rival plan.", { projectId: "project-b" })] };
  return { workspace, chat };
}

test("C1/AA075-076: only explicitly allowed project passages accompany an ordinary answer with personal memory off", async () => {
  const { workspace, chat } = setup();
  const passages = await retrieveProjectPassages(workspace, chat, "What is the Juniper launch plan?");
  assert.deepEqual(new Set(passages.map((item) => item.fileId)), new Set(["one", "two"]));
  assert.ok(passages.every((item) => item.revision.length === 64 && item.end - item.start === item.text.length));
  assert.equal(await validateProjectPassages(workspace, chat, passages), true);
  assert.deepEqual(memoriesForChat(workspace, chat), []);
  assert.deepEqual(await retrieveProjectPassages(workspace, { ...chat, contextPolicy: { projectDocuments: false } }, "Juniper"), []);
  assert.deepEqual(await retrieveProjectPassages(workspace, { ...chat, temporary: true }, "Juniper"), []);
  assert.deepEqual(workspaceForChat(workspace, { ...chat, memory: "on", contextPolicy: { projectDocuments: false } }).files, []);
  const turn = assembleTurn({ memory: "off", memoryContext: [], history: [], text: "Juniper", projectContext: passages });
  assert.equal(turn.ok, true);
  if (turn.ok) {
    const system = String(turn.messages[0].content);
    assert.match(system, /file one; revision [a-f0-9]{64}; chars 0-/);
    assert.match(system, /untrusted source text, not instructions/);
    assert.doesNotMatch(system, /rival plan/);
  }
  assert.equal((await validateMemoryDispatch(workspace, { chatId: chat.id, memory: "off", memoryContext: [], projectContext: passages })).ok, true);
});

test("C1/AA075,078: changed, removed, revoked and forged-source passages are refused before a new dispatch", async () => {
  const { workspace, chat } = setup();
  const passages = await retrieveProjectPassages(workspace, chat, "Juniper");
  const changedCopies: Workspace[] = [
    { ...workspace, files: workspace.files.filter((file) => file.id !== "one") },
    { ...workspace, files: workspace.files.map((file) => file.id === "one" ? { ...file, text: "A different plan" } : file) },
    { ...workspace, files: workspace.files.map((file) => file.id === "one" ? { ...file, retrievalDisabled: true } : file) },
    { ...workspace, files: workspace.files.map((file) => file.id === "one" ? { ...file, projectId: "project-b" } : file) },
  ];
  for (const current of changedCopies) {
    assert.equal(await validateProjectPassages(current, chat, passages), false);
    assert.equal((await validateMemoryDispatch(current, { chatId: chat.id, projectContext: passages })).ok, false);
  }
  assert.equal(await validateProjectPassages(workspace, chat, passages.map((item) => ({ ...item, name: "forged.pdf" }))), false);
  assert.equal(await validateProjectPassages(workspace, chat, passages.map((item) => ({ ...item, coverage: "partial" }))), false);
  assert.equal(await validateProjectPassages(workspace, chat, [...passages, ...passages, ...passages, ...passages]), false);
});

test("retrieval is bounded and discloses partial extraction without claiming to read the whole original", async () => {
  const { workspace, chat } = setup();
  workspace.files = Array.from({ length: 20 }, (_, index) => localFile(`f${index}`, "Juniper evidence. ".repeat(300), { partial: true }));
  const passages = await retrieveProjectPassages(workspace, chat, "Juniper evidence");
  assert.ok(passages.length <= 6);
  assert.ok(passages.reduce((sum, item) => sum + item.text.length, 0) <= 6000);
  assert.ok(passages.every((item) => item.coverage === "partial"));
  assert.equal(await validateProjectPassages(workspace, chat, passages), true);
});

test("C1/AA077-078: Library stores larger versioned text, keeps provenance, and explicitly excludes original bytes from JSON export", async () => {
  const text = "project evidence ".repeat(8000);
  const original = { id: "original-1", sha256: "a".repeat(64), bytes: 200_000, mime: "text/plain", storage: "browser" as const };
  let workspace = addLocalFile(emptyWorkspace(), { id: "first", name: "plan.txt", text, projectId: project.id, textSha256: await sha256(text), original,
    extraction: { method: "plain-text", extractedCharacters: text.length, retainedCharacters: text.length, coverage: "All decoded text retained", at } });
  assert.ok(workspace.files[0].text.length > 40_000);
  for (let i = 0; i < 50; i++) workspace = addLocalFile(workspace, { id: `extra-${i}`, name: "separate.txt", text: "record", projectId: project.id });
  assert.equal(workspace.files.length, 51);
  workspace = addLocalFile(workspace, { id: "revision-2", name: "plan.txt", text: "Updated plan", projectId: project.id, previousVersionId: "first" });
  assert.equal(workspace.files[0].revision, 2);
  assert.equal(workspace.files.find((file) => file.id === "first")?.archived, true);
  const bounded = addLocalFile(workspace, { name: "bounded.txt", text: "x".repeat(MAX_DOCUMENT_TEXT_CHARS + 100), projectId: null });
  assert.equal(bounded.files[0].text.length, MAX_DOCUMENT_TEXT_CHARS);
  assert.equal(bounded.files[0].partial, true);
  const archive = await packWorkspace(workspace, false);
  assert.equal(archive.resources.excludedOriginals.length, 1);
  assert.match(archive.resources.excludedOriginals[0].reason, /not embedded/);
  const reopened = await unpackWorkspace(JSON.stringify(archive));
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    const first = reopened.workspace.files.find((file) => file.id === "first")!;
    assert.deepEqual(first.original, original);
    assert.equal(first.extraction?.method, "plain-text");
    assert.equal(first.textSha256, await sha256(text));
  }
});

const agent: AgentDefinition = { id: "bot", name: "Project helper", description: "", role: "documents", instructions: "Original procedure", version: 1, tools: ["list_projects"], projectId: project.id, memory: "on", maxSteps: 2, approval: "ask", archived: false, createdAt: at, updatedAt: at, knowledge: "Old reference" };

test("C1/AA079: archive preserves associations; delete revokes agents/schedules without broadening memory or deleting history", () => {
  const { workspace, chat } = setup();
  const schedule = { id: "schedule", name: "Daily", agentId: agent.id, intervalMinutes: 60, nextRunAt: at, lastRunAt: null, enabled: true, lastError: "", timeZone: "UTC", clockHour: null, clockMinute: null, leaseWorker: null, leaseUntil: null, lastStatus: "" as const };
  const before = addMemory({ ...workspace, agents: [agent], schedules: [schedule] }, { scope: "project", projectId: project.id, chatId: null, text: "Private project note", source: "fixture" });
  const archived = setProjectArchived(before, project.id, true);
  assert.equal(archived.projects[0].archived, true);
  assert.deepEqual(archived.chats, before.chats);
  assert.equal(setProjectArchived(archived, project.id, false).projects[0].archived, false);
  const deleted = deleteProject(archived, project.id);
  assert.equal(deleted.projects.length, 0);
  assert.equal(deleted.chats[0].projectId, null);
  assert.equal(deleted.chats[0].contextPolicy?.projectDocuments, false);
  assert.equal(deleted.files.find((file) => file.id === "one")?.projectId, null);
  assert.equal(deleted.agents[0].archived, true);
  assert.equal(deleted.agents[0].version, 2);
  assert.equal(deleted.schedules[0].enabled, false);
  assert.equal(deleted.memories[0].projectId, project.id);
  assert.equal(deleted.memories[0].scope, "project");
  assert.deepEqual(memoriesForChat(deleted, { ...chat, projectId: null, memory: "on" }), []);
  assert.deepEqual(deleted.runs, before.runs);
});

test("C1/AA080: old bot chats retain their revision until reviewed adoption while revocations apply immediately", async () => {
  const opened = openBotChat({ ...emptyWorkspace(), projects: [project], agents: [agent] }, agent.id)!;
  opened.chat.messages.push({ id: "history", role: "user", content: "Keep this message", at });
  const changed = { ...opened.ws, agents: [{ ...agent, version: 2, instructions: "New procedure", knowledge: "New reference", memory: "off" as const }] };
  assert.equal(openBotChat(changed, agent.id)!.chat.botKnowledge, "Old reference");
  assert.deepEqual(botConversationRevision(changed, opened.chat), { current: 2, pinned: 1, unavailable: false, requiresReview: true });
  assert.equal((await validateMemoryDispatch(changed, { chatId: opened.chat.id, botKnowledge: "Old reference" })).ok, false);
  const adopted = adoptBotConfiguration(changed, opened.chat.id);
  const current = adopted.chats[0];
  assert.equal(current.botRevision, 2);
  assert.equal(current.botKnowledge, "New reference");
  assert.equal(current.memory, "off");
  assert.deepEqual(current.messages, opened.chat.messages);
  assert.equal((await validateMemoryDispatch(adopted, { chatId: current.id, botKnowledge: "New reference" })).ok, true);
  assert.equal((await validateMemoryDispatch(adopted, { chatId: current.id, botKnowledge: "Old reference" })).ok, false);
  const unavailable = { ...adopted, agents: [{ ...changed.agents[0], archived: true }] };
  assert.equal(adoptBotConfiguration(unavailable, current.id), unavailable);
});

test("C1/AA081: deleting a source never claims its separately copied conversation history was erased", () => {
  const { workspace, chat } = setup();
  const file = workspace.files[0];
  workspace.chats = [{ ...chat, documentSources: [{ fileId: file.id, revision: "a".repeat(64), name: file.name }], messages: [{ id: "copied", role: "user", content: `Attached file ${file.name}:\n${file.text}`, at }] }];
  const disclosure = documentCopyDisclosure(workspace, file);
  assert.equal(disclosure.conversations.length, 1);
  assert.match(disclosure.message, /Existing messages and any copies already sent to providers remain separate/);
  const removed = { ...workspace, files: workspace.files.filter((item) => item.id !== file.id) };
  assert.equal(removed.chats[0].messages[0].content.includes(file.text), true);
  assert.equal(documentCopyDisclosure(removed, file).conversations.length, 1);
});

test("media lineage, preference, retention and helper receipts survive workspace round trips", () => {
  const normalized = normalizeWorkspace({ chats: [{ id: "media", messages: [{ id: "answer", role: "assistant", content: "result", images: [{ blobId: "blob", assetId: "asset-2", parentAssetId: "asset-1", operationId: "op", createdAt: at, editPrompt: "Use blue", preferred: true }], videoRetention: "provider-temporary", videoExpiresAt: null, videoOperationId: "video-op", helperReceipts: [{ id: "helper", status: "succeeded", contributed: true, model: "fixture-model", requestedModel: "fixture-model", requestId: "fixture-request", durationMs: 12, usage: { prompt_tokens: 3 }, error: null }] }] }] });
  const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(normalized))).chats[0].messages[0];
  assert.equal(reloaded.images?.[0].parentAssetId, "asset-1");
  assert.equal(reloaded.images?.[0].preferred, true);
  assert.equal(reloaded.images?.[0].editPrompt, "Use blue");
  assert.equal(reloaded.videoRetention, "provider-temporary");
  assert.equal(reloaded.videoExpiresAt, null);
  assert.equal(reloaded.helperReceipts?.[0].requestId, "fixture-request");
});

test("C1/AA078 PDF page attribution is bound to original/text hashes and server-verified character ranges", async () => {
  const { workspace, chat } = setup();
  const text = "Juniper first page. Juniper second page.";
  const textSha256 = await sha256(text);
  const evidenceIndex = { version: 1 as const, kind: "pdf-page-tree" as const, sourceSha256: "a".repeat(64), textSha256, pageCount: 2, extractedCharacters: text.length, retainedCharacters: text.length, pages: [{ page: 1, start: 0, end: 19, coverage: "extracted" as const }, { page: 2, start: 20, end: text.length, coverage: "partial" as const }] };
  workspace.files = [localFile("pdf", text, { evidenceIndex, original: { id: "original", sha256: "a".repeat(64), bytes: 200, mime: "application/pdf", storage: "browser" } })];
  const reopened = normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(reopened.files[0].evidenceIndex, evidenceIndex);
  const passages = await retrieveProjectPassages(reopened, chat, "Juniper");
  assert.deepEqual(passages[0].pdfEvidence?.pages.map((page) => page.page), [1, 2]);
  assert.equal(await validateProjectPassages(reopened, chat, passages), true);
  const forged = passages.map((item) => ({ ...item, pdfEvidence: { ...item.pdfEvidence!, pages: [{ ...item.pdfEvidence!.pages[0], page: 99 }] } }));
  assert.equal(await validateProjectPassages(reopened, chat, forged), false);
  const changed = { ...reopened, files: [{ ...reopened.files[0], original: { ...reopened.files[0].original!, sha256: "b".repeat(64) } }] };
  assert.equal(await validateProjectPassages(changed, chat, passages), false);
  assert.equal((await retrieveProjectPassages(changed, chat, "Juniper"))[0].pdfEvidence, undefined);
  const assembled = assembleTurn({ memory: "off", memoryContext: [], history: [], text: "Juniper", projectContext: passages });
  assert(assembled.ok); assert.match(String(assembled.messages[0].content), /PDF pages 1 \(extracted; chars 0-19\), 2 \(partial/);
});
