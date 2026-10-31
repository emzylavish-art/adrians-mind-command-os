import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { runSkill, searchSkills } from "./skills.ts";

describe("skills", () => {
  it("lists a built-in skill and does not mark Notion installed", () => {
    const found = searchSkills("notion");
    assert.equal(found[0]?.kind, "not-installed");
    assert.match(found[0]?.needs ?? "", /not installed/);
    const projects = searchSkills("project");
    assert.equal(projects.some((skill) => skill.kind === "built-in"), true);
  });

  it("runs an enabled built-in skill and refuses one that is off or not installed", () => {
    const ws = emptyWorkspace();
    ws.projects.push({ id: "p", name: "Lake", description: "", createdAt: "2026-01-01T00:00:00.000Z" });
    const list = searchSkills("project").find((skill) => skill.id === "projects");
    assert.ok(list);
    if (!list) return;
    assert.match(runSkill(ws, list, true).text, /Lake/);
    assert.match(runSkill(ws, list, false).text, /turned off/);
    const notion = searchSkills("notion")[0];
    assert.ok(notion);
    if (!notion) return;
    assert.equal(runSkill(ws, notion, true).ok, false);
    assert.match(runSkill(ws, notion, true).text, /not installed/);
  });
});
