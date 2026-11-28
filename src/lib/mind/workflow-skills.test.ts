import { test } from "node:test";
import assert from "node:assert/strict";
import { createChat, emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { captureWorkflow, learnedWorkflows, learningEnabled, replyWorkflow, workflowKind, workflowMarkdown, type WorkflowKind } from "./workflow-skills.ts";
import { createDraft, emptyLibrary, reviewDraft } from "./skill-library.ts";
import { validateSkillFixture } from "./skill-activation.ts";
import { quarantineImportedMemory } from "./archive-review.ts";
import type { Msg } from "./types.ts";

const make = () => createChat(emptyWorkspace(), { memory: "on", temporary: false, projectId: null, autonomy: "ask" });
function completed(id: string, kind: WorkflowKind, minute = 0): Msg {
  return { id, role: "assistant", at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(), content: "private result with secret", workflowKind: kind };
}

test("only a known procedure in an owned chat with effective memory and history can be captured", () => {
  const { chat } = make();
  assert.equal(captureWorkflow(chat, "owner", "web_search"), "web_search");
  for (const changed of [{ ...chat, temporary: true }, { ...chat, memory: "off" as const }, { ...chat, contextPolicy: { history: false } }, { ...chat, contextPolicy: { saveMemories: false } }]) {
    assert.equal(captureWorkflow(changed, "owner", "web_search", chat), undefined);
    assert.equal(captureWorkflow(chat, "owner", "web_search", changed), undefined);
  }
  assert.equal(captureWorkflow(chat, null, "web_search"), undefined);
  assert.equal(workflowKind("__proto__"), undefined);
  assert.equal(workflowKind("run_due_schedules"), undefined);
  assert.equal(learningEnabled({ getItem: () => "off" }), false);
  assert.equal(learningEnabled({ getItem() { throw Error(); } }), false);
});

test("study only recorded operations, update recurring pairs, retain no chat text, and yield a reusable reviewed fixture", () => {
  const { ws, chat } = make();
  chat.messages = [completed("1","list_projects"), completed("2","web_search",1), completed("3","list_projects",2), completed("4","web_search",3)];
  const stored = normalizeWorkspace({ ...ws, chats: [chat] });
  const drafts = learnedWorkflows(stored.chats);
  const pair = drafts.find(row => row.id === "list_projects-then-web_search");
  assert.equal(pair?.count, 2);
  assert.equal(pair?.latest, chat.messages.at(-1)?.at);
  const file = workflowMarkdown(pair!);
  assert.match(file, /^---\nname: list-projects-then-web-search\ndescription:/);
  assert.match(file, /1\. List the projects/);
  assert.doesNotMatch(JSON.stringify(drafts), /private|secret/);
  assert.equal(learnedWorkflows([{ ...chat, temporary: true }]).length, 0);
  assert.equal(learnedWorkflows(quarantineImportedMemory(stored, emptyWorkspace()).chats).length, 0);
  const draft = reviewDraft(createDraft(emptyLibrary(), pair!.content), "draft-1");
  assert.equal(validateSkillFixture(draft, "draft-1", "Research this workspace project with source links").ok, true);
});

test("failed, inherited, duplicate, unrelated or stale steps do not create sequence evidence", () => {
  const { chat } = make();
  chat.messages = [completed("1","list_chats"), completed("2","web_search",1),
    completed("3","list_chats",2), { ...completed("4","web_search",3), kind: "error" },
    { ...completed("5","web_search",4), inheritedFrom: { chatId: "other", messageId: "old" } },
    completed("6","list_chats",5), completed("7","web_search",100), completed("7","web_search",100)];
  const drafts = learnedWorkflows([chat]);
  assert.equal(drafts.length, 2);
  assert.equal(drafts.find(row => row.id === "web_search")?.count, 2);
  assert.equal(replyWorkflow({ consultation: [{ id: "helper", ok: false, text: "failed", originalCharacters: 6, truncated: false }], usedIds: [] }), undefined);
  assert.equal(replyWorkflow({ usedIds: ["note"] }), "memory_answer");
});
