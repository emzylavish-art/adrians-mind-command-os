import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const readJson = async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const [checklist, sources, readme] = await Promise.all([
  readJson('findings.json'), readJson('source-index.json'), readFile(resolve(directory, 'README.md'), 'utf8'),
]);
const ids = Array.from({ length: 136 }, (_, i) => `AA-${String(i + 1).padStart(3, '0')}`);
const statuses = new Set([
  'fixed and tested', 'already fixed with proof', 'duplicate with a link to its fix',
  'proposal needing a decision', 'blocked with the exact missing step',
]);
assert.deepEqual(checklist.findings.map((finding) => finding.id), ids, 'Exact sorted original inventory required');
assert.equal(sources.recoveredRecordCount, 32);
assert.equal(sources.sourceRecords.length, 32);
assert.equal(new Set(sources.sourceRecords.map((record) => record.record)).size, 32);
assert.equal(sources.findingInventory.length, 136);
const originals = new Map(sources.findingInventory.map((finding) => [finding.id, finding]));
assert.equal(originals.size, 136);
const counts = {};
let filesChecked = 0;
for (const finding of checklist.findings) {
  const original = originals.get(finding.id);
  assert.ok(original, finding.id);
  assert.equal(finding.title, original.title, `${finding.id}: original title`);
  assert.equal(finding.auditId, original.auditId, `${finding.id}: original audit ID`);
  assert.equal(finding.source.url, original.source, `${finding.id}: original source`);
  assert.equal(finding.source.record, original.record, `${finding.id}: source record`);
  assert.ok(statuses.has(finding.status), `${finding.id}: explicit status`);
  counts[finding.status] = (counts[finding.status] ?? 0) + 1;
  for (const value of [finding.expectedBehavior, finding.implementation.summary, finding.acceptance.pass, finding.acceptance.fail]) {
    assert.ok(typeof value === 'string' && value.trim(), `${finding.id}: complete behavioral contract`);
  }
  assert.ok(finding.evidence.levels.length, `${finding.id}: evidence level`);
  for (const path of [...finding.implementation.files, ...finding.evidence.testFiles]) {
    const target = resolve(repository, path);
    assert.ok(target.startsWith(repository + sep), `${finding.id}: repository file path`);
    assert.ok((await stat(target)).isFile(), `${finding.id}: ${path}`);
    filesChecked += 1;
  }
  if (finding.status.startsWith('proposal') || finding.status.startsWith('blocked')) {
    assert.ok(finding.remaining.length, `${finding.id}: exact unresolved work`);
  }
  if (finding.status.startsWith('duplicate')) {
    assert.ok(finding.relatedFixes.length && finding.relatedFixes.every((id) => ids.includes(id)), `${finding.id}: linked implementation`);
  }
  assert.ok(readme.includes(`[${finding.id}](`), `${finding.id}: README inventory row`);
}
assert.deepEqual(checklist.statusCounts, counts, 'Status totals must match actual rows');
for (const [, link] of readme.matchAll(/\]\(([^)]+)\)/g)) {
  if (link.startsWith('https://') || link.startsWith('#')) continue;
  assert.ok((await stat(resolve(directory, link))).isFile(), `README link: ${link}`);
}
console.log(`PASS: 136 exact findings, 32 source records, ${filesChecked} file references, explicit statuses and contracts, README links and totals.`);
