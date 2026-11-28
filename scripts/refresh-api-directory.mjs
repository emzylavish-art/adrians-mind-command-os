// Refresh the public discovery index independently of builds and account credentials.
import { readFile, rename, writeFile } from "node:fs/promises";
const source = "https://api.apis.guru/v2/list.json";
const input = process.argv[2];
const catalog = input ? JSON.parse(await readFile(input, "utf8")) : await download();
async function download() {
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`API directory returned ${response.status}`);
  return response.json();
}
const entries = [];
for (const [id, versions] of Object.entries(catalog)) {
  const record = versions.versions[versions.preferred];
  const logo = record.info["x-logo"]?.url || "";
  const { swaggerUrl: specification } = record;
  if (!specification?.startsWith("https://api.apis.guru/v2/specs/")) continue;
  entries.push({
    id,
    title: record.info.title || id,
    category: (record.info["x-apisguru-categories"] || []).join(", "),
    logo: logo.startsWith("https://api.apis.guru/v2/cache/logo/") && !logo.includes("no-logo") ? logo : "",
    specification,
  });
}
if (!entries.length) throw new Error("Empty API directory");
entries.sort((a, b) => a.id.localeCompare(b.id, "en"));
const output = new URL("../public/catalog/apis.json", import.meta.url);
const staging = new URL("./apis.json.tmp", output);
await writeFile(staging, JSON.stringify({ source, entries }));
await rename(staging, output);
console.log(`Saved ${entries.length} API specifications`);
