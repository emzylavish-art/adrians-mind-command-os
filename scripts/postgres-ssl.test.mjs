import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUPABASE_ROOT_2021_CA,
  supabasePostgresPoolOptions,
  withoutSslMode,
} from "../src/lib/auth/postgres-ssl.mjs";

test("shared Supabase Postgres options pin the CA and require certificate validation", () => {
  const config = supabasePostgresPoolOptions("postgres://user:pass@db.example.test/app?sslmode=require");
  assert.equal(config.connectionString, "postgres://user:pass@db.example.test/app");
  assert.equal(config.ssl.ca, SUPABASE_ROOT_2021_CA);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /^-----BEGIN CERTIFICATE-----/);
  assert.match(config.ssl.ca, /-----END CERTIFICATE-----$/);
});

test("SSL URL parameters are removed while unrelated connection parameters are preserved", () => {
  assert.equal(
    withoutSslMode("postgres://user:pass@db.example.test/app?sslmode=require&sslrootcert=%2Ftmp%2Fca.pem&application_name=migrate"),
    "postgres://user:pass@db.example.test/app?application_name=migrate",
  );
  assert.equal(
    withoutSslMode("postgres://user:pass@db.example.test/app?application_name=migrate&sslmode=verify-full"),
    "postgres://user:pass@db.example.test/app?application_name=migrate",
  );
  assert.equal(
    withoutSslMode("postgres://user:pass@db.example.test/app?sslmode=require"),
    "postgres://user:pass@db.example.test/app",
  );
});
