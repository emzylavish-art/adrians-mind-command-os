import { readFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../tools/registry.json", import.meta.url), "utf8"));
const schema = JSON.parse(await readFile(new URL("../tools/status.schema.json", import.meta.url), "utf8"));
const allowed = new Set(schema.properties.status.enum);
const required = ["name", "status", "install", "live"];
const seen = new Set();

for (const item of registry.tools) {
  for (const key of required) {
    if (!(key in item)) throw new Error(`Tool entry missing ${key}: ${JSON.stringify(item)}`);
  }
  if (seen.has(item.name)) throw new Error(`Duplicate tool name: ${item.name}`);
  seen.add(item.name);
  if (!allowed.has(item.status)) throw new Error(`Unknown status for ${item.name}: ${item.status}`);
  if (item.status === "live-verified" && (item.install !== "installed" || item.live !== "connected" || !item.evidence || !item.verifiedAt)) {
    throw new Error(`Live-verified tool lacks installation/connection evidence: ${item.name}`);
  }
}
console.log(`Validated ${registry.tools.length} tool registry entries.`);
