import assert from "node:assert/strict";
import { test } from "node:test";
import { addMemory, createChat, deleteMemory, emptyWorkspace, reviseMemory, workspaceForChat } from "../workspace.ts";
import { effectiveContextPolicy, freshContextPolicy } from "./context-policy.ts";
import { memoryPolicyRevision, validateMemoryDispatch } from "./dispatch-policy.ts";
import { assertCurrentMemoryContext, readAuthorizedAgentContext } from "./dispatch-policy.server.ts";
import type { Sql } from "../../db.ts";

async function setup() {
  const owner = { ...emptyWorkspace(), projects: [{ id: "p", name: "Fixture project", description: "", createdAt: "2026-01-01T00:00:00.000Z" }] };
  const created = createChat(owner, { memory: "on", autonomy: "ask", temporary: false, projectId: "p" });
  const workspace = addMemory(created.ws, { scope: "project", projectId: "p", chatId: null, text: "Private current note", source: "fixture" });
  const body = { chatId: created.chat.id, memory: "on", memoryContext: workspace.memories.map(({ id, text }) => ({ id, text })), memoryPolicyRevision: await memoryPolicyRevision(workspace, created.chat) };
  return { workspace, chat: created.chat, body };
}

test("C1/AA007-008: saved context is rejected after memory-off, deletion, archive or revision", async () => {
  const { workspace, chat, body } = await setup();
  assert.equal((await validateMemoryDispatch(workspace, body)).ok, true);
  const changed = [
    { ...workspace, projects: [] },
    { ...workspace, chats: [{ ...chat, memory: "off" as const }] },
    deleteMemory(workspace, workspace.memories[0].id),
    { ...workspace, memories: workspace.memories.map((note) => ({ ...note, archived: true })) },
    reviseMemory(workspace, workspace.memories[0].id, "Corrected note"),
    { ...workspace, chats: [{ ...chat, projectId: "other" }] },
  ];
  for (const current of changed) assert.equal((await validateMemoryDispatch(current, body)).ok, false);
});

test("unknown owner/conversation cannot replay saved notes, including legacy revisionless payloads", async () => {
  const { body, workspace } = await setup();
  assert.equal((await validateMemoryDispatch(emptyWorkspace(), body)).ok, false);
  assert.equal((await validateMemoryDispatch(workspace, { ...body, memoryPolicyRevision: undefined })).ok, true);
  assert.equal((await validateMemoryDispatch(deleteMemory(workspace, workspace.memories[0].id), { ...body, memoryPolicyRevision: undefined })).ok, false);
});

test("authoritative dispatch rereads the authenticated owner, including revocation between two calls", async () => {
  const { workspace, body } = await setup();
  let current = workspace;
  const owners: unknown[] = [];
  const sql = (async (_strings: TemplateStringsArray, owner: unknown) => {
    owners.push(owner);
    return owner === "a" ? [{ payload: current }] : [];
  }) as Sql;
  sql.query = async () => [];
  assert.equal((await assertCurrentMemoryContext("a", body, sql)).ok, true);
  current = deleteMemory(current, current.memories[0].id);
  assert.equal((await assertCurrentMemoryContext("a", body, sql)).ok, false);
  assert.equal((await assertCurrentMemoryContext("b", body, sql)).ok, false);
  assert.deepEqual(owners, ["a", "a", "b"]);
});

test("C1/AA009: fresh context excludes history and copied bot knowledge; ordinary memory-off preserves history", async () => {
  const { workspace, chat } = await setup();
  assert.equal(effectiveContextPolicy({ ...chat, memory: "off" }).history, true);
  const fresh = { ...chat, memory: "off" as const, contextPolicy: freshContextPolicy() };
  const current = { ...workspace, chats: [fresh] };
  assert.equal((await validateMemoryDispatch(current, { chatId: chat.id, memory: "off", memoryContext: [], history: [{ role: "user", content: "old" }] })).ok, false);
  assert.equal((await validateMemoryDispatch(current, { chatId: chat.id, memory: "off", memoryContext: [], history: [], botKnowledge: "old" })).ok, false);
  assert.equal((await validateMemoryDispatch(current, { chatId: chat.id, memory: "off", memoryContext: [], history: [], botKnowledge: "" })).ok, true);
});

test("explicit project-document permission is independent of personal memory and denied in temporary chats", () => {
  const made = createChat(emptyWorkspace(), { memory: "off", temporary: false, projectId: "p", autonomy: "ask" });
  const workspace = { ...made.ws, files: [{ id: "file", name: "plan.txt", text: "project plan", bytes: 12, projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" }] };
  const permitted = { ...made.chat, contextPolicy: { projectDocuments: true } };
  assert.equal(workspaceForChat(workspace, permitted).files.length, 1);
  assert.deepEqual(workspaceForChat(workspace, permitted).memories, []);
  assert.deepEqual(workspaceForChat(workspace, { ...permitted, temporary: true }).files, []);
});

test("planner uses current owner records and rejects revoked legacy name/title/note payloads at each step", async () => {
  const { workspace, chat } = await setup();
  let current = { ...workspace, projects: [{ id: "p", name: "Private project", description: "", createdAt: "2026-01-01T00:00:00.000Z" }] };
  const sql = (async (_strings: TemplateStringsArray, owner: unknown) => owner === "owner" ? [{ payload: current }] : []) as Sql;
  sql.query = async () => [];
  const body = { chatId: chat.id, projects: ["Private project"], chats: [chat.title], notes: current.memories.map((note) => note.text) };
  const allowed = await readAuthorizedAgentContext("owner", body, sql);
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.workspace.projects[0].id, "p");
    assert.equal(allowed.workspace.memories[0].scope, "project");
    assert.equal(allowed.workspace.memories[0].id, workspace.memories[0].id);
  }
  assert.equal((await readAuthorizedAgentContext("other-owner", body, sql)).ok, false);
  assert.equal((await readAuthorizedAgentContext("owner", { ...body, chatId: undefined }, sql)).ok, false);
  current = deleteMemory(current, current.memories[0].id);
  assert.equal((await readAuthorizedAgentContext("owner", body, sql)).ok, false);
  assert.equal((await readAuthorizedAgentContext("owner", { notes: [], projects: [], chats: [] }, sql)).ok, true);
});
