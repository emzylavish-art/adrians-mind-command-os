import { spawnSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const built = spawnSync(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"], { cwd: root, stdio: "inherit", env: { ...process.env, ADRIAN_DESKTOP: "1" } });
if (built.status !== 0) process.exit(built.status ?? 1);
const source = join(root, ".output");
if (!(await stat(join(source, "server/index.mjs"))).isFile()) throw new Error("The native node-server entry is missing; packaging was not staged.");
const identity = JSON.parse(await readFile(join(root, "desktop/runtime-build.json"), "utf8"));
const next = join(root, "desktop", `app-server.next-${process.pid}`);
const target = join(root, "desktop/app-server");
const previous = join(root, "desktop", `app-server.previous-${process.pid}`);
try {
  await cp(source, next, { recursive: true });
  await mkdir(join(next, "server/_libs"), { recursive: true });
  for (const file of ["pglite.data", "pglite.wasm", "initdb.wasm"]) await copyFile(join(root, "node_modules/@electric-sql/pglite/dist", file), join(next, "server/_libs", file));
  await writeFile(join(next, "runtime-build.json"), JSON.stringify(identity, null, 2) + "\n");
  try { await rename(target, previous); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await rename(next, target); } catch (error) { await rename(previous, target).catch(() => undefined); throw error; }
  await rm(previous, { recursive: true, force: true });
  console.log(`Native server staged for artifact ${identity.artifactId}; source ${identity.revision ?? "unreported"}${identity.dirty ? " (uncommitted)" : ""}. No database migration, installer, or provider ran.`);
} finally { await rm(next, { recursive: true, force: true }); }
