import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decideFetchSite } from "../request-guard.ts";

describe("mind postgres TLS helper", () => {
  it("points the mind pool at the verified helper and does not disable TLS", async () => {
    const source = readFileSync(new URL("../../db.ts", import.meta.url), "utf8");
    const helper = readFileSync(new URL("../../auth/pg-pool.ts", import.meta.url), "utf8");
    assert.match(source, /postgresPool\(databaseUrl\)/);
    assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
    assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED/);
    assert.match(helper, /rejectUnauthorized:\s*true/);
    assert.match(helper, /SUPABASE_ROOT_2021/);
    assert.match(helper, /sslmode=/);
    try {
      const { postgresPool } = await import("../../auth/pg-pool.ts");
      const pool = postgresPool("postgres://user:pass@127.0.0.1:1/db?sslmode=require");
      const ssl = pool.options.ssl as { rejectUnauthorized?: boolean; ca?: string };
      assert.equal(ssl.rejectUnauthorized, true);
      assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
      assert.doesNotMatch(String(pool.options.connectionString), /sslmode=/);
      await pool.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Cannot find package") && !message.includes("ERR_MODULE_NOT_FOUND")) throw error;
    }
  });
});

describe("scripted origin policy", () => {
  it("blocks cross-site and same-site scripted posts and ignores no forwarded host", () => {
    assert.equal(decideFetchSite({ site: "same-origin", mode: "cors", dest: "empty", method: "POST" }), "allow");
    assert.equal(decideFetchSite({ site: "cross-site", mode: "cors", dest: "empty", method: "POST" }), "block");
    assert.equal(decideFetchSite({ site: "same-site", mode: "cors", dest: "empty", method: "POST" }), "block");
  });
});
