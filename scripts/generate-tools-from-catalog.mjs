#!/usr/bin/env node
/**
 * Emit tools/from-catalog.json from src/lib/mind/mcp/tool-catalog.ts (SSOT).
 * Does not rewrite tools/registry.json GitHub inventory — that file stays curated.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { loadToolsPagePayload } = await import(
  pathToFileURL(join(root, "src/lib/mind/tools-registry/load-registry.ts")).href
);

const payload = loadToolsPagePayload({
  registryPath: join(root, "tools", "registry.json"),
  verificationsDir: join(root, "tools", "verifications"),
});

const out = {
  generatedAt: new Date().toISOString(),
  sourceOfTruth: payload.sourceOfTruth,
  hardExcluded: payload.hardExcluded,
  builtins: payload.builtins.map((t) => ({
    name: t.name,
    category: t.category,
    status: t.status,
    install: t.install,
    live: t.live,
    callable: t.callable,
    builtinId: t.builtinId,
  })),
  registryCallable: payload.registry.filter((t) => t.callable).map((t) => t.name),
  registryUnverifiedGithub: payload.registry
    .filter((t) => t.githubSourced && !t.callable)
    .map((t) => t.name),
};

mkdirSync(join(root, "tools"), { recursive: true });
writeFileSync(join(root, "tools", "from-catalog.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote tools/from-catalog.json", {
  builtins: out.builtins.length,
  unverifiedGithub: out.registryUnverifiedGithub.length,
});
