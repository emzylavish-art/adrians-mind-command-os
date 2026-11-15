import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCKED_CONTROLS,
  DEPARTMENTS,
  FACE_FILE,
  ORCHESTRATOR,
  PAIRED_ACTIONS,
  fleetRules,
  routeTask,
} from "./departments.ts";

const EXPECTED = [
  "Engineering",
  "Design",
  "Media",
  "Research",
  "Knowledge",
  "Security",
  "Operations",
  "Marketing",
  "Personal assistant",
];

describe("departments", () => {
  it("exports the nine departments and one orchestrator", () => {
    assert.deepEqual(DEPARTMENTS, EXPECTED);
    assert.equal(ORCHESTRATOR, "adrian-core");
    assert.equal((DEPARTMENTS as readonly string[]).includes(ORCHESTRATOR), false);
    assert.equal(new Set(DEPARTMENTS).size, DEPARTMENTS.length);
  });

  it("shares one workspace memory and does not grant halt, secrets, or a second brain", () => {
    const rules = fleetRules();
    assert.equal(rules, fleetRules());
    assert.equal(rules.orchestrator, "adrian-core");
    assert.equal(rules.memoryId, "workspace");
    assert.equal(rules.separateBrain, false);
    assert.equal(rules.secrets, false);
    assert.equal(rules.canHalt, false);
    assert.equal(rules.canApprove, false);
    assert.equal(rules.face, "public/brand/eve-idle.jpg");
    assert.equal(rules.face, FACE_FILE);
    assert.deepEqual(rules.actions, ["file_read", "file_write", "file_delete", "terminal"]);
    assert.equal(rules.actions, PAIRED_ACTIONS);
    assert.equal(rules.haltBlocks, PAIRED_ACTIONS);
    assert.deepEqual(rules.blocked, ["mouse", "keyboard", "browser pointer", "windows desktop"]);
    assert.equal(rules.blocked, BLOCKED_CONTROLS);
  });

  it("returns one department name and never the orchestrator", () => {
    const samples = [
      "Build the TypeScript router",
      "Design the layout",
      "Cut a video",
      "Research the citation",
      "Search the notes",
      "Check the security threat",
      "Watch uptime",
      "Write the marketing campaign",
      "Remind me about the inbox",
      "",
      "adrian-core",
      "use a second orchestrator",
      "Engineering and Design should both run",
      "ask nova-core and adrian-core to implement the bug",
    ];
    for (const sample of samples) {
      const routed = routeTask(sample);
      assert.equal(typeof routed, "string");
      assert.equal((DEPARTMENTS as readonly string[]).includes(routed), true);
      assert.notEqual(routed, ORCHESTRATOR);
      assert.equal(routed.includes(","), false);
      assert.equal(Array.isArray(routed), false);
    }
    assert.equal(routeTask(null), "Personal assistant");
  });

  it("routes a named department to that name only, even when another is mentioned later", () => {
    assert.equal(routeTask("Engineering and Design should both run"), "Engineering");
    assert.equal(routeTask("Marketing, then Research"), "Marketing");
    assert.equal(routeTask("Personal assistant should also do Research"), "Personal assistant");
  });

  it("routes work by the first matching department and ignores a second orchestrator", () => {
    assert.equal(routeTask("implement the bug"), "Engineering");
    assert.equal(routeTask("mockup the layout"), "Design");
    assert.equal(routeTask("edit the video"), "Media");
    assert.equal(routeTask("investigate the citation"), "Research");
    assert.equal(routeTask("open the wiki notes"), "Knowledge");
    assert.equal(routeTask("the windows desktop and mouse stay blocked"), "Security");
    assert.equal(routeTask("monitor the incident"), "Operations");
    assert.equal(routeTask("the audience campaign"), "Marketing");
    assert.equal(routeTask("calendar reminder"), "Personal assistant");
    assert.equal(routeTask("second orchestrator named nova"), "Personal assistant");
    assert.notEqual(routeTask("adrian-core should implement the code"), ORCHESTRATOR);
    assert.equal(routeTask("adrian-core should implement the code"), "Engineering");
  });
});
