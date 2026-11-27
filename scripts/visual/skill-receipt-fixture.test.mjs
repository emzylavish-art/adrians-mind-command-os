import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertSkillReceiptRows, skillReceiptFixture } from "./skill-receipt-fixture.mjs";

const rows = [
  ...[1, 2, 3].map((id) => `draft:draft-${id}:v2 · version 2 · Instructions included. Checks: scope checked, instruction bounds validated, instructions included. Tools executed: none. Task output remains unverified.`),
  "browser · version 1 · Not used: this skill has no available registered adapter. Checks: selection report received. Tools executed: none. Task output remains unverified. Selection reported by this client; no server execution proof.",
];

test("the browser receipt fixture is serializable synthetic context with no tool or verification success", () => {
  const receipts = JSON.parse(JSON.stringify(skillReceiptFixture()));
  assert.equal(receipts.filter((row) => row.stage === "instructions_applied").length, 3);
  assert.equal(receipts.filter((row) => row.stage === "dependency_unavailable").length, 1);
  assert.ok(receipts.every((row) => row.verified === false && row.toolsExecuted.length === 0));
  assert.deepEqual(assertSkillReceiptRows(rows), { state: "passed", instructionsIncluded: 3, dependencyUnavailable: 1, toolsExecuted: 0, taskOutput: "unverified", source: "synthetic stored receipts after hydration" });
});

test("rendered receipt assertions reject lost non-use reasons and positive execution or verification claims", () => {
  assert.throws(() => assertSkillReceiptRows(rows.slice(0, 3)), /lost a stored receipt/);
  assert.throws(() => assertSkillReceiptRows([...rows.slice(0, 3), rows[3].replace("Not used: this skill has no available registered adapter.", "Instructions included.")]));
  assert.throws(() => assertSkillReceiptRows(rows.map((row) => row.replace("Tools executed: none.", "Tools executed: open_browser."))));
  assert.throws(() => assertSkillReceiptRows(rows.map((row) => row.replace("Task output remains unverified.", "Task output verified."))));
});

test("the layout script checks expanded hydrated receipts without sending the seeded task", () => {
  const source = readFileSync(new URL("./chat-layout.mjs", import.meta.url), "utf8");
  assert.match(source, /i === count - 1 && i % 2 \? \{ skillReceipts \}/);
  assert.match(source, /skillReceipts: skillReceiptFixture\(\)/);
  assert.match(source, /await skillSummary\.click\(\);[\s\S]*?assertSkillReceiptRows\(await skillDetails\.locator\("li"\)\.allTextContents\(\)\)/);
  assert.match(source, /renderedMessages:[^\n]+skillReceiptReview/);
  assert.doesNotMatch(source, /getByRole\("button", \{ name: "Send", exact: true \}\)\.click\(/);
});
