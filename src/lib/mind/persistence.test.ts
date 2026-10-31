import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePersistence } from "./persistence.ts";

describe("persistence", () => {
  it("does not treat a missing database as durable or cloud backup", () => {
    for (const value of [undefined, "", "   "]) {
      const described = describePersistence(value);
      assert.equal(described.backend, "memory");
      assert.equal(described.cloudBackup, false);
      assert.equal(described.restartChecked, false);
      assert.match(described.note, /in-memory/);
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
});
