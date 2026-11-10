import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl, resolveMigrateDatabaseUrl } from "./database-url.mjs";

test("resolveDatabaseUrl prefers DATABASE_URL then POSTGRES_URL", () => {
  assert.equal(resolveDatabaseUrl({}), undefined);
  assert.equal(resolveDatabaseUrl({ POSTGRES_URL: " postgres://pg " }), "postgres://pg");
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL: "postgres://db", POSTGRES_URL: "postgres://pg" }),
    "postgres://db",
  );
});

test("resolveMigrateDatabaseUrl prefers the direct URL over pooled URLs", () => {
  assert.equal(
    resolveMigrateDatabaseUrl({
      DATABASE_URL: "postgres://pool-from-database-url",
      POSTGRES_URL_NON_POOLING: "postgres://direct",
      POSTGRES_URL: "postgres://pool",
    }),
    "postgres://direct",
  );
});
