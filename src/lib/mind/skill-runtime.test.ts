import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestSkills } from "./decision-router.ts";
import { createSkillToolRegistry } from "./skill-tools.ts";
import { runSkill, SKILLS, skillReadiness, type Skill } from "./skills.ts";
import { emptyWorkspace } from "./workspace.ts";

test("a development task finds compatible frontend, accessibility and test instructions", () => {
  const skills = ["frontend", "accessibility", "testing"].map(id => ({ id, name: id, description: `${id} guidance`, kind: "installed", authorized: true }));
  assert.deepEqual(new Set(suggestSkills("Build an accessible React interface and verify it", skills, {}).map(item => item.skillId)), new Set(["frontend", "accessibility", "testing"]));
  assert.equal(suggestSkills("Build an accessible React interface and verify it", skills, { testing: false }).some(item => item.skillId === "testing"), false);
  assert.deepEqual(suggestSkills("frontend", [{ ...skills[0], authorized: false }], {}), []);
});
test("instruction retrieval does not report execution or verified implementation", () => {
  const result = runSkill(emptyWorkspace(), SKILLS.find(skill => skill.id === "adrian-os-builder")!, true);
  assert.equal(result.receipt.stage, "instruction_retrieved"); assert.equal(result.receipt.verified, false);
  assert.match(result.text, /No tool was executed/);
});
test("a registered tool can extend execution without a new runSkill branch and readiness is rechecked", () => {
  let available = true, calls = 0;
  const registry = createSkillToolRegistry([{ id: "fixture_accessibility", description: "Synthetic workspace check", permissions: ["workspace:read"], available: () => available ? { ok: true } : { ok: false, reason: "Fixture dependency removed" }, execute: () => { calls++; return { ok: true, text: "Fixture checked" }; } }]);
  const skill: Skill = { id: "fixture", name: "Fixture", description: "accessibility", kind: "built-in", needs: "registered tool", input: "", output: "", tool: "fixture_accessibility" };
  assert.equal(runSkill(emptyWorkspace(), skill, true, "", registry).receipt.stage, "tool_executed");
  available = false;
  assert.equal(skillReadiness(skill, true, emptyWorkspace(), registry).available, false);
  assert.equal(runSkill(emptyWorkspace(), skill, true, "", registry).ok, false);
  assert.equal(calls, 1);
});
