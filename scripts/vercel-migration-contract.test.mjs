import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
});
