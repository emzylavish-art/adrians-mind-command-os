import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl, resolveMigrateDatabaseUrl, supabaseDatabaseRef } from "./database-url.mjs";

test("resolveDatabaseUrl prefers DATABASE_URL then POSTGRES_URL", () => {
  assert.equal(resolveDatabaseUrl({}), undefined);
  assert.equal(resolveDatabaseUrl({ POSTGRES_URL: " postgres://pg " }), "postgres://pg");
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL: "postgres://db", POSTGRES_URL: "postgres://pg" }),
    "postgres://db",
  );
});

test("identifies Supabase project across direct and pool connections", () => {
  assert.equal(supabaseDatabaseRef("postgres://postgres@db.adrianfixture.supabase.co/postgres"), "adrianfixture");
  assert.equal(supabaseDatabaseRef("postgres://postgres.adrianfixture@aws-0-use.pooler.supabase.com/postgres"), "adrianfixture");
  assert.equal(supabaseDatabaseRef("postgres://postgres.other@postgres.example.test/postgres"), undefined);
  assert.equal(supabaseDatabaseRef("bad input"), undefined);
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
