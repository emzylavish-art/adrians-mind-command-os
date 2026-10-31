import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./with-app-env.mjs";

const destDir = join(projectRoot(), ".vercel/output/functions/__server.func/_libs");
const srcDir = join(projectRoot(), "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

if (!existsSync(destDir)) {
  console.error("[pglite] build output is missing; skipping asset copy");
  process.exit(0);
}

for (const name of files) {
  copyFileSync(join(srcDir, name), join(destDir, name));
}
console.log("[pglite] copied runtime assets next to the server bundle");
