import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));

describe("candidate build and explicit migration contract", () => {
  it("candidate build copies assets without mutating production schema", () => {
    const vercel = readJson("vercel.json");
    const pkg = readJson("package.json");
    assert.equal(vercel.buildCommand, "npm run build");
    assert.doesNotMatch(pkg.scripts.build, /migrate/);
    assert.match(pkg.scripts["release:prepare"], /release-promotion\.mjs/);
    assert.match(pkg.scripts.build, /node scripts\/copy-pglite-assets\.mjs/);
    const compile = pkg.scripts.build.indexOf("vite build");
    const assets = pkg.scripts.build.indexOf("node scripts/copy-pglite-assets.mjs");
    assert.ok(compile >= 0 && assets > compile);
  });

  it("the desktop package copies the embedded database files and production does not serve the tiny installer stub", () => {
    const vercel = readJson("vercel.json");
    const copy = readFileSync(new URL("./copy-pglite-assets.mjs", import.meta.url), "utf8");
    assert.match(copy, /desktop\/app-server\/server\/_libs/);
    assert.match(copy, /pglite\.data/);
    const manifest = readJson("public/desktop-update.json");
    assert.equal(manifest.download, "https://github.com/emzylavish-art/adrians-mind-command-os/releases/tag/desktop-installer");
    for (const path of ["/downloads/AdriansMind-Setup.exe", "/downloads/AdriansMind-Setup-Full.exe"]) {
      const redirect = vercel.redirects.find((rule) => rule.source === path);
      assert.equal(redirect?.destination, manifest.download);
    }
  });

  it("production migrations and app Postgres access share the pinned CA helper", () => {
    const migrator = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8");
    const appPool = readFileSync(new URL("../src/lib/auth/pg-pool.ts", import.meta.url), "utf8");
    assert.match(migrator, /supabasePostgresPoolOptions/);
    assert.match(appPool, /supabasePostgresPoolOptions/);
  });

  it("Vercel preview and development builds cannot run SQL migrations", () => {
    for (const environment of ["preview", "development"]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./migrate.mjs", import.meta.url))], {
        env: {
          ...process.env,
          VERCEL: "1",
          VERCEL_ENV: environment,
          DATABASE_URL: "postgresql://bad:bad@127.0.0.1:1/unavailable",
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /non-production Vercel environment/);
    }
  });

  it("production rejects cross-project migration targets before dialing Postgres", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./migrate.mjs", import.meta.url))], {
      env: {
        PATH: process.env.PATH,
        VERCEL: "1",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgresql://postgres.first@aws-0-test.pooler.supabase.com/postgres",
        POSTGRES_URL_NON_POOLING: "postgresql://postgres@db.other.supabase.co/postgres",
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /migration database does not match/);
  });
});

it("explicit release preparation fails when SQL would be skipped", () => {
  const file = fileURLToPath(new URL("./migrate.mjs", import.meta.url));
  for (const env of [{}, { VERCEL: "1", VERCEL_ENV: "preview" }]) {
    const result = spawnSync(process.execPath, [file, "--require-database"], {
      env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release migration/);
  }
});
