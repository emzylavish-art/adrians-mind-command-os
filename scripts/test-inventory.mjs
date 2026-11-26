import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

/** One inventory for npm test and CI shards. Live probes use different names. */
export function discoverTests(root = repositoryRoot, kind = "all") {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.test\.(?:mjs|ts)$/.test(entry.name)) files.push(relative(root, path).split("\\").join("/"));
    }
  }
  if (kind !== "typed") visit(resolve(root, "scripts"));
  if (kind !== "scripts") visit(resolve(root, "src"));
  return files.sort();
}

export function selectShard(files, shard, count) {
  if (!Number.isInteger(count) || count < 1 || count > 32 || !Number.isInteger(shard) || shard < 0 || shard >= count) throw new Error("Expected a zero-based shard and a shard count between 1 and 32.");
  return files.filter((_, index) => index % count === shard);
}
