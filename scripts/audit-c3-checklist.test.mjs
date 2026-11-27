import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const ledger = JSON.parse(readFileSync(new URL("docs/audits/c3-continue-production/findings.json", root), "utf8"));
const statuses = new Set(["fixed and tested", "already fixed with proof", "duplicate with a link to its fix", "proposal needing a decision", "blocked with the exact missing step"]);

test("C3 implementation accounts for every recovered finding exactly once", () => {
  assert.equal(ledger.recovery.records, 43);
  assert.equal(ledger.findings.length, 256);
  assert.deepEqual(ledger.findings.map((row) => row.id).sort(), Array.from({ length: 256 }, (_, index) => `AA-${String(index + 1).padStart(3, "0")}`));
  for (const row of ledger.findings) {
    assert(statuses.has(row.status), row.id);
    assert(row.original_title && row.original_source && row.original_record, row.id);
    assert(row.expected_behavior_and_acceptance.length > 0, `${row.id}: original requirements missing`);
    assert(row.changed_behavior && row.files.length, `${row.id}: missing code mapping`);
    if (row.status === "fixed and tested" || row.status === "already fixed with proof") assert(row.tests.length, `${row.id}: missing regression evidence`);
    if (row.status === "blocked with the exact missing step" || row.status === "proposal needing a decision") assert(row.still_needed?.length, `${row.id}: missing next step`);
  }
});

test("website code and tests referenced by the implementation checklist exist", () => {
  for (const row of ledger.findings) {
    if (row.implementation_branch !== ledger.website_branch) continue;
    for (const path of [...row.files, ...row.tests]) assert(existsSync(new URL(path, root)), `${row.id}: ${path}`);
  }
});
