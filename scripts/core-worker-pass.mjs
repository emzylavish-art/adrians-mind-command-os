#!/usr/bin/env node
/**
 * One hosted pass over every saved workspace snapshot.
 * Refuses to start unless the caller already resolved a database URL.
 * Does not call models, Paperclip, browsers or mail providers.
 */
import { getSql } from "../src/lib/db.ts";
import { applyCorePass } from "../src/lib/mind/core-runtime.ts";
import { readControl, readSnapshot, listSnapshotUserIds, writeSnapshot } from "../src/lib/mind/store.ts";
import { normalizeWorkspace } from "../src/lib/mind/workspace.ts";

const sql = await getSql();
const ids = await listSnapshotUserIds(sql);
const now = new Date().toISOString();
let advanced = 0;
let halted = 0;
let skipped = 0;
for (const userId of ids) {
  const raw = await readSnapshot(sql, userId);
  if (!raw) {
    skipped += 1;
    continue;
  }
  const workspace = normalizeWorkspace(raw);
  const controlHalted = await readControl(sql, userId);
  const next = applyCorePass({
    workspace: { ...workspace, halted: workspace.halted || controlHalted },
    now,
    workerId: "hosted-worker",
  });
  await writeSnapshot(sql, userId, next.workspace);
  if (next.summary.halted) halted += 1;
  else advanced += 1;
}
console.log(JSON.stringify({ ok: true, users: ids.length, advanced, halted, skipped }));
