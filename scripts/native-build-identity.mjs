import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** One immutable identity is compiled into the server and packaged beside the launcher. */
export function nativeBuildIdentityPlugin() {
  let identity;
  return {
    name: "adrian-native-build-identity",
    configResolved(config) {
      const release = JSON.parse(readFileSync(join(config.root, "public/desktop-update.json"), "utf8"));
      const desktop = JSON.parse(readFileSync(join(config.root, "desktop/package.json"), "utf8"));
      let revision = null; let dirty = true;
      try { revision = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: config.root, encoding: "utf8" }).trim(); dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: config.root, encoding: "utf8" }).trim(); } catch { /* Missing source identity remains explicit and cannot pass release packaging. */ }
      identity = { product: "adrians-mind", build: release.build, version: desktop.version, revision, dirty, artifactId: randomUUID(), builtAt: new Date().toISOString() };
      if (config.command === "build") writeFileSync(join(config.root, "desktop/runtime-build.json"), JSON.stringify(identity, null, 2) + "\n");
    },
    resolveId(id) { return id === "virtual:adrian-native-build-identity" ? "\0" + id : null; },
    load(id) { return id === "\0virtual:adrian-native-build-identity" ? `export const nativeBuildIdentity = ${JSON.stringify(identity)};` : null; },
  };
}
