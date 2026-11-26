import assert from "node:assert/strict";

/** Synthetic stored receipts only: no skill, provider, or tool executes in this fixture. */
export function skillReceiptFixture() {
  return [
    ...[1, 2, 3].map((id) => ({
      skillId: `draft:draft-${id}:v2`, version: 2, stage: "instructions_applied",
      toolsExecuted: [], checksCompleted: ["scope_checked", "instruction_bounds_validated", "instructions_included"],
      remainingUnverified: ["model_adherence", "tool_execution", "task_output"], reportedBy: "context_assembly", verified: false,
    })),
    {
      skillId: "browser", version: 1, stage: "dependency_unavailable",
      toolsExecuted: [], checksCompleted: ["selection_report_received"],
      remainingUnverified: ["tool_execution", "task_output"], reportedBy: "client_selection", verified: false,
    },
  ];
}

/** Check actual rendered list text, keeping omitted guidance distinct from included context. */
export function assertSkillReceiptRows(rows) {
  assert.equal(rows.length, 4, "Skills considered lost a stored receipt during hydration.");
  for (const id of [1, 2, 3]) {
    const row = rows.find((text) => text.startsWith(`draft:draft-${id}:v2 `));
    assert(row, `Missing included skill ${id}.`);
    assert.match(row, /Instructions included\./);
    assert.match(row, /Checks: scope checked, instruction bounds validated, instructions included\./);
  }
  const unavailable = rows.find((text) => text.startsWith("browser "));
  assert(unavailable, "Missing unavailable dependency receipt.");
  assert.match(unavailable, /Not used: this skill has no available registered adapter\./);
  assert.match(unavailable, /Selection reported by this client; no server execution proof\./);
  assert.doesNotMatch(unavailable, /Instructions included|queued for coding/);
  for (const row of rows) {
    assert.match(row, /Tools executed: none\./);
    assert.match(row, /Task output remains unverified\./);
  }
  return { state: "passed", instructionsIncluded: 3, dependencyUnavailable: 1, toolsExecuted: 0, taskOutput: "unverified", source: "synthetic stored receipts after hydration" };
}
