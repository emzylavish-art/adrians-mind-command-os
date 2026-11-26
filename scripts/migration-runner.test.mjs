import assert from "node:assert/strict";
import { it } from "node:test";
import { applyMigrationSet, migrationChecksum } from "./migration-runner.mjs";

function fixture(initial = []) {
  const ledger = new Map(initial.map((row) => [row.name, { ...row }]));
  const executed = [];
  const queries = [];
  const tx = {
    query: async (text, params = []) => {
      queries.push(text);
      if (text.startsWith("SELECT name")) return { rows: [...ledger.values()] };
      if (text.startsWith("UPDATE _migrations")) ledger.set(params[0], { name: params[0], checksum: params[1], checksum_origin: "legacy-baseline" });
      if (text.startsWith("INSERT INTO _migrations")) {
        if (ledger.has(params[0])) throw Error("duplicate migration");
        ledger.set(params[0], { name: params[0], checksum: params[1], checksum_origin: "applied" });
      }
      return { rows: [] };
    },
    exec: async (text) => { executed.push(text); },
  };
  return { tx, ledger, executed, queries };
}

it("detects changed applied bytes before executing any pending schema", async () => {
  const { tx, ledger, executed } = fixture();
  const sources = { "0001_a.sql": "create table fixture_a (id text primary key);" };
  assert.deepEqual((await applyMigrationSet(tx, sources)).applied, ["0001_a.sql"]);
  assert.equal(ledger.get("0001_a.sql").checksum, migrationChecksum(sources["0001_a.sql"]));
  const before = executed.length;
  await assert.rejects(applyMigrationSet(tx, { "0001_a.sql": sources["0001_a.sql"] + " -- changed", "0002_b.sql": "create table fixture_b (id text);" }), /Applied migration 0001_a.sql changed/);
  assert.equal(executed.length, before);
  assert.equal(ledger.has("0002_b.sql"), false);
});

it("records legacy baselines without claiming to verify the originally applied bytes", async () => {
  const { tx, ledger, executed } = fixture([{ name: "0001_a.sql", checksum: null }]);
  const messages = [];
  const result = await applyMigrationSet(tx, { "0001_a.sql": "create table a (id text);" }, { log: (message) => messages.push(message) });
  assert.deepEqual(result.baselined, ["0001_a.sql"]);
  assert.deepEqual(result.verified, []);
  assert.equal(executed.length, 0);
  assert.equal(ledger.get("0001_a.sql").checksum_origin, "legacy-baseline");
  assert.match(messages[0], /not independently verified/);
});

it("reads the ledger after obtaining the PostgreSQL lock and never reapplies a completed migration", async () => {
  const { tx, executed, queries } = fixture();
  const sources = { "0001_once.sql": "create table once_only (id text);" };
  let queue = Promise.resolve();
  const transaction = (operation) => {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const results = await Promise.all([1, 2].map(() => transaction(() => applyMigrationSet(tx, sources, { postgres: true }))));
  assert.equal(results.reduce((count, result) => count + result.applied.length, 0), 1);
  assert.equal(executed.length, 1);
  const lock = queries.findIndex((text) => text.includes("pg_advisory_xact_lock"));
  const read = queries.findIndex((text) => text.startsWith("SELECT name"));
  assert.ok(lock >= 0 && lock < read);
  assert.match(queries[0], /lock_timeout/);
});
