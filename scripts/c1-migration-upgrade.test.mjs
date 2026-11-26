import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const migrationDirectory = new URL("../migrations/", import.meta.url);
const c1Migrations = [
  "0017_c1_oauth_contract.sql",
  "0018_c1_resource_authority.sql",
  "0019_c1_media_operations.sql",
  "0020_c1_device_coordination.sql",
  "0021_c1_research_skills.sql",
];
const c1Tables = [
  "mind_notion_operation_status",
  "mind_resource_policy",
  "mind_resource_day",
  "mind_resource_operation",
  "mind_media_operations",
  "mind_pc_agents",
  "mind_pc_jobs",
  "mind_pc_events",
  "mind_research_report",
  "mind_research_report_version",
  "mind_skill_preferences",
  "mind_skill_execution",
];

async function applyFile(database, name, record = true) {
  await database.exec("BEGIN");
  try {
    await database.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    if (record) await database.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    await database.exec("COMMIT");
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  }
}

test("C1 SQL upgrades a populated pre-C1 database and additive replay preserves identity, receipts and data", async () => {
  // Always an isolated in-memory PostgreSQL engine. This test never reads a
  // database URL, calls the deployment migrator or opens an existing data file.
  const database = new PGlite();
  try {
    await database.exec("CREATE TABLE _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = await readdir(fileURLToPath(migrationDirectory));
    const baseline = pendingMigrations(files, []).filter(({ name }) => name < c1Migrations[0]);
    assert.equal(baseline.length, 14, "exercise the complete schema at the inspected pre-C1 base");
    for (const { name } of baseline) await applyFile(database, name);

    const archivedWorkspace = {
      workspaceId: "legacy-workspace",
      workspaceName: "Archived fixture workspace",
      archived: true,
      accessTokenEnc: "synthetic-archived-ciphertext",
    };
    await database.query(
      `INSERT INTO mind_oauth_connections
        (owner_id, connector, access_token_enc, refresh_token_enc, workspace_id, account_label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["fixture-owner", "notion", "synthetic-access-ciphertext", "synthetic-refresh-ciphertext", "legacy-workspace", "Legacy account"],
    );
    await database.query("INSERT INTO mind_notion_workspaces (owner_id, workspace_id, record) VALUES ($1, $2, $3::jsonb)",
      ["fixture-owner", "legacy-workspace", JSON.stringify(archivedWorkspace)]);
    await database.query(
      `INSERT INTO mind_turn_receipt (user_id, operation_id, request_hash, expires_at, responded, retryable)
       VALUES ($1, $2, $3, $4, true, false)`,
      ["fixture-owner", "completed-before-upgrade", "legacy-request-hash", "2099-01-01T00:00:00.000Z"],
    );

    const applied = (await database.query("SELECT name FROM _migrations")).rows.map(({ name }) => name);
    const pending = pendingMigrations(c1Migrations, applied);
    assert.deepEqual(pending.map(({ name }) => name), c1Migrations);
    for (const { name } of pending) await applyFile(database, name);

    const grant = (await database.query("SELECT * FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2", ["fixture-owner", "notion"])).rows[0];
    assert.equal(grant.access_token_enc, "synthetic-access-ciphertext");
    assert.equal(grant.refresh_token_enc, "synthetic-refresh-ciphertext");
    assert.equal(grant.account_label, "Legacy account");
    assert.equal(grant.workspace_id, "legacy-workspace");
    assert.match(grant.grant_generation, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(grant.external_account_id, null, "an upgrade must not invent a provider subject identity");
    assert.deepEqual((await database.query("SELECT record FROM mind_notion_workspaces WHERE owner_id = $1 AND workspace_id = $2", ["fixture-owner", "legacy-workspace"])).rows[0].record, archivedWorkspace);

    const receipt = (await database.query("SELECT * FROM mind_turn_receipt WHERE user_id = $1 AND operation_id = $2", ["fixture-owner", "completed-before-upgrade"])).rows[0];
    assert.equal(receipt.request_hash, "legacy-request-hash");
    assert.equal(receipt.responded, true);
    assert.equal(receipt.retryable, false);
    assert.equal(receipt.response_body, null, "new columns cannot reconstruct an old provider response");
    assert.equal(receipt.response_status, null);
    assert.equal(receipt.response_type, null);

    const createdTables = (await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map(({ table_name }) => table_name);
    for (const name of c1Tables) assert.ok(createdTables.includes(name), `${name} exists after the actual SQL upgrade`);

    const policy = { freeOnly: true, dailyCallLimit: 7 };
    const mediaResult = { status: "completed", source: "synthetic-provider-receipt" };
    const reportResult = { summary: "Synthetic retained research result", citations: [] };
    await database.query("INSERT INTO mind_resource_policy (owner_id, revision, policy) VALUES ($1, 3, $2::jsonb)", ["fixture-owner", JSON.stringify(policy)]);
    await database.query("INSERT INTO mind_media_operations (owner_id, id, kind, payload_hash, state, result_json) VALUES ($1, $2, 'image', $3, 'completed', $4::jsonb)",
      ["fixture-owner", "media-before-replay", "synthetic-payload-hash", JSON.stringify(mediaResult)]);
    await database.query("INSERT INTO mind_research_report (owner_id, report_id, revision, question, result) VALUES ($1, $2, 1, $3, $4::jsonb)",
      ["fixture-owner", "research-before-replay", "Synthetic question", JSON.stringify(reportResult)]);
    await database.query("INSERT INTO mind_research_report_version (owner_id, report_id, revision, result) VALUES ($1, $2, 1, $3::jsonb)",
      ["fixture-owner", "research-before-replay", JSON.stringify(reportResult)]);

    const recorded = (await database.query("SELECT name FROM _migrations")).rows.map(({ name }) => name);
    assert.deepEqual(pendingMigrations(c1Migrations, recorded), [], "normal bookkeeping does not apply recorded files again");
    assert.equal(recorded.length, baseline.length + c1Migrations.length);

    // Deliberately replay the real additive SQL too: a recovery replay must not
    // rotate a grant or replace records created after the initial upgrade.
    for (const name of c1Migrations) await applyFile(database, name, false);
    const replayedGrant = (await database.query("SELECT * FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2", ["fixture-owner", "notion"])).rows[0];
    assert.deepEqual(replayedGrant, grant);
    assert.deepEqual((await database.query("SELECT * FROM mind_turn_receipt WHERE user_id = $1 AND operation_id = $2", ["fixture-owner", "completed-before-upgrade"])).rows[0], receipt);
    assert.deepEqual((await database.query("SELECT revision, policy FROM mind_resource_policy WHERE owner_id = $1", ["fixture-owner"])).rows[0], { revision: 3, policy });
    assert.deepEqual((await database.query("SELECT state, result_json FROM mind_media_operations WHERE owner_id = $1 AND id = $2", ["fixture-owner", "media-before-replay"])).rows[0], { state: "completed", result_json: mediaResult });
    assert.deepEqual((await database.query("SELECT result FROM mind_research_report_version WHERE owner_id = $1 AND report_id = $2", ["fixture-owner", "research-before-replay"])).rows[0].result, reportResult);
    await database.query("DELETE FROM mind_research_report WHERE owner_id = $1 AND report_id = $2", ["fixture-owner", "research-before-replay"]);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM mind_research_report_version WHERE owner_id = $1 AND report_id = $2", ["fixture-owner", "research-before-replay"])).rows[0].count, 0, "report deletion cascades to its stored versions");
  } finally {
    await database.close();
  }
});
