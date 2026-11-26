import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activateReviewedSkill, collectAccountSkillApplications, SKILL_ACTIVATIONS_KEY, skillApplicationContext, skillReceiptSummary, validateSkillFixture, type SkillActivation } from "./skill-activation.ts";
import { createDraft, emptyLibrary, reviewDraft, serializeLibrary, STORAGE_KEY } from "./skill-library.ts";
import { chatTurnBody } from "./logic-routes.ts";
import { assembleTurn } from "./prompt.ts";
import { prepareBuildTask } from "./kimi/build-guidance.ts";
import { createChat, emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { pullMindEvents } from "./stream.ts";

const task = "Build an accessible React interface, verify its tests and use the cloud browser.";
function fixture(bodies = ["Use semantic elements.", "Check keyboard focus.", "Run appropriate test fixtures."]) {
  let library = emptyLibrary();
  let activations: SkillActivation[] = [];
  for (const [index, name] of ["Frontend", "Accessibility", "Testing"].entries()) {
    library = reviewDraft(createDraft(library, { title: name, summary: `${name} guidance`, body: bodies[index] }), `draft-${index + 1}`);
    activations = activateReviewedSkill(library, activations, `draft-${index + 1}`, validateSkillFixture(library, `draft-${index + 1}`, task), "both", true);
  }
  const values = new Map([[STORAGE_KEY, serializeLibrary(library)], [SKILL_ACTIVATIONS_KEY, JSON.stringify(activations)]]);
  return { storage: { getItem: (key: string) => values.get(key) || null }, values, activations };
}

test("three authorized skills and an unavailable dependency retain distinct receipts through chat, SSE and reload", () => {
  const { storage } = fixture();
  const selection = collectAccountSkillApplications(storage, task);
  assert.equal(selection.applications.length, 3);
  const request = chatTurnBody({ text: task, memory: "off", halted: false, history: [], memoryContext: [], provider: "grok", modelTier: "Auto", logicRoute: null, images: [], skillApplications: selection });
  const assembled = assembleTurn({ text: task, memory: "off", history: [], memoryContext: [], skillApplications: JSON.parse(JSON.stringify(request)).skillApplications });
  assert.equal(assembled.ok, true); if (!assembled.ok) return;
  assert.equal(assembled.skillReceipts.filter(item => item.stage === "instructions_applied").length, 3);
  const missing = assembled.skillReceipts.find(item => item.skillId === "browser")!;
  assert.equal(missing.stage, "dependency_unavailable");
  assert.equal(missing.reportedBy, "client_selection");
  assert.match(skillReceiptSummary(missing), /no available registered adapter/);
  assert.doesNotMatch(String(assembled.messages[0].content), /No cloud browser is configured/);
  assert.ok(assembled.skillReceipts.every(item => item.verified === false && item.toolsExecuted.length === 0 && item.remainingUnverified?.includes("task_output")));
  const events = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "Synthetic answer", model: "fixture", usedIds: [], skillReceipts: assembled.skillReceipts })}\n\n`).events;
  assert.equal(events[0].event, "done"); if (events[0].event !== "done") return;
  assert.deepEqual(events[0].skillReceipts, assembled.skillReceipts);
  const made = createChat(emptyWorkspace(), { memory: "off", autonomy: "ask", temporary: false, projectId: null });
  made.chat.messages = [{ id: "answer", role: "assistant", content: "Synthetic answer", at: "", skillReceipts: events[0].skillReceipts }];
  assert.deepEqual(normalizeWorkspace({ ...made.ws, chats: [made.chat] }).chats[0].messages[0].skillReceipts, assembled.skillReceipts);
  const build = prepareBuildTask(task, selection);
  assert.equal(build.ok, true); if (build.ok) assert.deepEqual(build.skillReceipts, assembled.skillReceipts);
});

test("capacity, disabled and scope omissions preserve their reason without sending the omitted instructions", () => {
  const source = fixture(["a".repeat(6000), "b".repeat(6000), "c".repeat(6000)]);
  const limited = skillApplicationContext(collectAccountSkillApplications(source.storage, task));
  assert.equal(limited.receipts.find(item => item.skillId === "draft:draft-3:v2")?.stage, "omitted_context_limit");
  assert.doesNotMatch(limited.text, /ccc/);
  source.values.set(SKILL_ACTIVATIONS_KEY, JSON.stringify(source.activations.map((item, index) => ({ ...item, scope: index === 1 ? "build" : "both" }))));
  const scoped = skillApplicationContext(collectAccountSkillApplications(source.storage, task, { "draft:draft-1:v2": false }));
  assert.equal(scoped.receipts.find(item => item.skillId === "draft:draft-1:v2")?.stage, "omitted_disabled");
  assert.equal(scoped.receipts.find(item => item.skillId === "draft:draft-2:v2")?.stage, "omitted_scope");
  assert.doesNotMatch(scoped.text, /aaa|bbb/);
});

test("untrusted selection receipts cannot fabricate included instructions, executed tools or completed checks", () => {
  const result = skillApplicationContext({ applications: [], receipts: [
    { skillId: "fake", version: 1, stage: "instructions_applied", toolsExecuted: ["write_database"], verified: true },
    { skillId: "browser", version: 1, stage: "dependency_unavailable", toolsExecuted: ["open_browser"], checksCompleted: ["production_passed"], verified: true },
  ] });
  assert.equal(result.text, ""); assert.equal(result.receipts.length, 1);
  assert.deepEqual(result.receipts[0].toolsExecuted, []);
  assert.deepEqual(result.receipts[0].checksCompleted, ["selection_report_received"]);
  assert.equal(result.receipts[0].verified, false);
  assert.doesNotMatch(skillReceiptSummary(result.receipts[0]), /production passed|write database|open browser/);
});

test("instruction selection tolerates denied browser storage without granting a skill", () => {
  assert.deepEqual(collectAccountSkillApplications({ getItem: () => { throw new Error("Storage unavailable"); } }, task), { applications: [], receipts: [] });
});

test("mounted chat and Build send the selection envelope and render its actual stages", () => {
  for (const relative of ["../../components/mind/command-app.tsx", "../../components/mind/build-workspace.tsx"]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /skillApplications: collectAccountSkillApplications\([^\n]+\),/);
    assert.doesNotMatch(source, /skillApplications: collectAccountSkillApplications\([^\n]+\)\.applications/);
  }
  for (const relative of ["../../components/mind/chat-pane.tsx", "../../components/mind/build-workspace.tsx"]) assert.match(readFileSync(new URL(relative, import.meta.url), "utf8"), /skillReceiptSummary\(/);
});
