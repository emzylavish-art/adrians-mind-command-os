import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./with-app-env.mjs";

const srcDir = join(projectRoot(), "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const destDirs = [
  ".vercel/output/functions/__server.func/_libs",
  ".output/server/_libs",
  "desktop/app-server/server/_libs",
  "desktop/dist/win-unpacked/resources/app-server/server/_libs",
].map((dir) => join(projectRoot(), dir));

const present = destDirs.filter((dir) => existsSync(dir));
if (present.length === 0) {
  console.error("[pglite] no server bundle is present; skipping asset copy");
  process.exit(0);
}

for (const destDir of present) {
  mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    copyFileSync(join(srcDir, name), join(destDir, name));
  }
  console.log(`[pglite] copied runtime assets to ${destDir}`);
}
