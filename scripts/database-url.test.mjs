import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDatabaseUrl,
  resolveMigrateDatabaseUrl,
  buildMigratePoolConfig,
  stripSslModeFromDatabaseUrl,
  migrateFailuresAreFatal,
} from "./database-url.mjs";

test("resolveDatabaseUrl prefers DATABASE_URL then POSTGRES_URL", () => {
  assert.equal(resolveDatabaseUrl({}), undefined);
  assert.equal(resolveDatabaseUrl({ POSTGRES_URL: " postgres://pg " }), "postgres://pg");
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL: "postgres://db", POSTGRES_URL: "postgres://pg" }),
    "postgres://db",
  );
});

test("resolveMigrateDatabaseUrl prefers non-pooling when DATABASE_URL unset", () => {
  assert.equal(
    resolveMigrateDatabaseUrl({
      POSTGRES_URL_NON_POOLING: "postgres://direct",
      POSTGRES_URL: "postgres://pool",
    }),
    "postgres://direct",
  );
});

test("stripSslModeFromDatabaseUrl removes sslmode and ssl query params", () => {
  assert.equal(
    stripSslModeFromDatabaseUrl(
      "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require",
    ),
    "postgresql://user:pass@db.example.com:5432/postgres",
  );
  assert.equal(
    stripSslModeFromDatabaseUrl(
      "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require&schema=public",
    ),
    "postgresql://user:pass@db.example.com:5432/postgres?schema=public",
  );
  assert.equal(
    stripSslModeFromDatabaseUrl(
      "postgresql://user:pass@db.example.com:5432/postgres?ssl=true&sslmode=verify-full",
    ),
    "postgresql://user:pass@db.example.com:5432/postgres",
  );
});

test("buildMigratePoolConfig sets rejectUnauthorized false after stripping sslmode", () => {
  const cfg = buildMigratePoolConfig(
    "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require",
    { max: 1 },
  );
  assert.equal(cfg.max, 1);
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
  assert.equal(cfg.connectionString.includes("sslmode"), false);
  assert.match(cfg.connectionString, /^postgresql:\/\//);
});

test("migrateFailuresAreFatal only for VERCEL_ENV=production", () => {
  assert.equal(migrateFailuresAreFatal({}), false);
  assert.equal(migrateFailuresAreFatal({ VERCEL_ENV: "preview" }), false);
  assert.equal(migrateFailuresAreFatal({ VERCEL_ENV: "development" }), false);
  assert.equal(migrateFailuresAreFatal({ VERCEL_ENV: "production" }), true);
});
