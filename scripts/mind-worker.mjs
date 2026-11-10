#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolveDatabaseUrl } from "./database-url.mjs";

const url = resolveDatabaseUrl(process.env) ?? "";
if (!url) {
  console.error("No DATABASE_URL/POSTGRES_URL. The hosted worker has no queue to poll. Nothing ran.");
  process.exit(2);
}
if (url.includes("ybxowvzicirinpdcfyqe") || url.includes("espmxiitzucooxblmnpr")) {
  console.error("Refusing a forbidden database. Nothing ran.");
  process.exit(1);
}

const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/core-worker-pass.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (child.error) {
  console.error("The hosted worker pass could not start. Nothing was marked complete.");
  process.exit(1);
}
process.exit(child.status ?? 1);
