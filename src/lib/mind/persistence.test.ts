import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { databaseMode, describePersistence, hostedDatabaseSetup } from "./persistence.ts";

describe("persistence", () => {
  it("does not treat a missing database as durable or cloud backup", () => {
    for (const value of [undefined, "", "   "]) {
      const described = describePersistence(value);
      assert.equal(described.backend, "memory");
      assert.equal(described.cloudBackup, false);
      assert.equal(described.restartChecked, false);
      assert.match(described.note, /\.data\/pglite/);
      assert.match(described.note, /not cloud backup/);
    }
  });

  it("does not claim a configured database was restart-tested", () => {
    const described = describePersistence("postgres://mind.example/mind");
    assert.equal(described.backend, "postgres");
    assert.equal(described.cloudBackup, false);
    assert.equal(described.restartChecked, false);
    assert.match(described.note, /not verified cloud backup/);
  });

  it("refuses a forbidden project ref in the database url", () => {
    const described = describePersistence("postgres://ybxowvzicirinpdcfyqe");
    assert.equal(described.backend, "refused");
    assert.equal(described.cloudBackup, false);
  });

  it("names the local file mode and the variables a future host needs", () => {
    assert.equal(databaseMode("memory").pill, "Local file");
    assert.match(databaseMode("postgres").detail, /No restart test/);
    assert.equal(databaseMode("refused").pill, "Refused");
    const setup = hostedDatabaseSetup();
    assert.deepEqual(setup.variables, ["DATABASE_URL"]);
    assert.equal(setup.migrate, "npm run db:migrate");
    assert.equal(setup.forbidden.includes("ybxowvzicirinpdcfyqe"), true);
    assert.equal(setup.forbidden.includes("espmxiitzucooxblmnpr"), true);
  });
});
