import assert from "node:assert/strict";
import test from "node:test";
import { emptyWorkspace, addProject, createChat, normalizeWorkspace } from "./workspace.ts";
import { editProject, saveProjectTask, removeProject, projectInstructionsForChat } from "./project-workspace.ts";

test("project instructions survive reload and apply only to their project", () => {
  const made = addProject(emptyWorkspace(), "Build", "site"); const chat = createChat(made.ws, { projectId: made.project.id, memory: "on", autonomy: "ask", temporary: false }).chat;
  const ws = { ...made.ws, chats: [chat] }; const changed = editProject(ws, made.project.id, { name: "Build", description: "site", lifecycle: "active", instructions: "Use the approved palette" }); assert.ok(changed.ok);
  if (!changed.ok) return; const restored = normalizeWorkspace(changed.workspace); assert.match(projectInstructionsForChat(restored, chat.id), /approved palette/); assert.equal(projectInstructionsForChat(restored, "other"), "");
  assert.equal(editProject(ws, made.project.id, { name: "Build", description: "", instructions: "x".repeat(8001) }).ok, false);
});
test("task dependency cycles and premature completion are rejected", () => {
  const made = addProject(emptyWorkspace(), "Build", ""); let ws = made.ws; const project = made.project; const task = (id: string, dependsOn: string[] = [], status: "todo" | "done" = "todo") => ({ id, title: id, status, dependsOn, updatedAt: new Date().toISOString() });
  const first = saveProjectTask(ws, project.id, task("a")); assert.ok(first.ok); if (!first.ok) return; ws = first.workspace;
  const second = saveProjectTask(ws, project.id, task("b", ["a"])); assert.ok(second.ok); if (!second.ok) return; ws = second.workspace;
  assert.equal(saveProjectTask(ws, project.id, task("a", ["b"])).ok, false); assert.equal(saveProjectTask(ws, project.id, task("b", ["a"], "done")).ok, false);
});
test("project deletion archives notes without widening their scope", () => {
  const { ws, project } = addProject(emptyWorkspace(), "Private", ""); ws.memories.push({ id: "m", scope: "project", projectId: project.id, chatId: null, text: "private", source: "owner", archived: false, versions: [], createdAt: "", updatedAt: "" });
  const removed = removeProject(ws, project.id); assert.equal(removed.memories[0].archived, true); assert.equal(removed.memories[0].scope, "project"); assert.equal(removed.memories[0].projectId, project.id);
});
