import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));

describe("production build and migration contract", () => {
  it("Vercel must execute the audited package build, not skip database migrations", () => {
    const vercel = readJson("vercel.json");
    const pkg = readJson("package.json");
    assert.equal(vercel.buildCommand, "npm run build");
    assert.match(pkg.scripts.build, /node scripts\/migrate\.mjs/);
    assert.match(pkg.scripts.build, /node scripts\/copy-pglite-assets\.mjs/);
    const compile = pkg.scripts.build.indexOf("vite build");
    const migration = pkg.scripts.build.indexOf("node scripts/migrate.mjs");
    const assets = pkg.scripts.build.indexOf("node scripts/copy-pglite-assets.mjs");
    assert.ok(compile >= 0 && migration > compile && assets > migration);
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
});
