/**
 * Live verify: MIND_SEARCH xAI adapter returns real http(s) source URLs.
 * Loads /home/box/.secrets/xai_inference.env — never prints the key.
 * If the key is missing, exits with a clear MOCK/SKIP note (unit tests cover the contract).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const secretsPath = "/home/box/.secrets/xai_inference.env";

function loadSecrets() {
  try {
    const raw = readFileSync(secretsPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*export\s+([A-Z0-9_]+)=(.*)$/) || line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* missing handled below */
  }
}

loadSecrets();

const { resolveXaiInferenceApiKey } = await import(pathToFileURL(resolve(root, "src/lib/mind/xai-adapter.ts")).href);
const { resolveMindSearchBackend, createXaiMindSearchFetch, XAI_MIND_SEARCH_ADAPTER_ENDPOINT } = await import(
  pathToFileURL(resolve(root, "src/lib/mind/xai-search-adapter.ts")).href
);
const { performSearch, researchReportToMarkdown } = await import(pathToFileURL(resolve(root, "src/lib/mind/research.ts")).href);

const lines = [];
function log(msg) {
  lines.push(msg);
  console.log(msg);
}

const keyed = resolveXaiInferenceApiKey(process.env);
if (!keyed.ok) {
  log(`SKIP_LIVE: inference key not available (${keyed.reason || keyed.error}). Unit tests cover the adapter with mocks.`);
  mkdirSync(resolve(root, ".handoff"), { recursive: true });
  writeFileSync(resolve(root, ".handoff/RESEARCH_DEEP_LIVE.txt"), lines.join("\n") + "\n");
  process.exit(0);
}
log(`PASS: inference key loaded server-side (len=${keyed.key.length}; value not printed)`);

const backend = resolveMindSearchBackend(process.env);
log(`INFO: backend.kind=${backend.kind}`);
if (backend.kind === "none") {
  log(`FAIL: expected xai-adapter or dedicated, got none`);
  process.exit(1);
}

const fetchImpl =
  backend.kind === "xai-adapter"
    ? createXaiMindSearchFetch({ apiKey: backend.apiKey, model: backend.model })
    : fetch;

const result = await performSearch({
  query: "What is Toledo Bend Reservoir? site:en.wikipedia.org",
  deep: false,
  endpoint: backend.kind === "xai-adapter" ? XAI_MIND_SEARCH_ADAPTER_ENDPOINT : backend.endpoint,
  key: backend.key,
  fetchImpl,
  timeoutMs: 60_000,
});

log(`INFO: ok=${result.ok} configured=${result.configured} citations=${result.citations.length}`);
if (result.error) log(`INFO: error=${result.error.slice(0, 200)}`);
for (const c of result.citations) {
  log(`CITE: ${c.title.slice(0, 80)} — ${c.url}`);
  if (!/^https?:\/\//i.test(c.url)) {
    log(`FAIL: non-http citation ${c.url}`);
    process.exit(1);
  }
}

if (!result.ok || result.citations.length === 0) {
  log("FAIL: expected at least one real http(s) citation from live search");
  process.exit(1);
}

const deep = await performSearch({
  query: "Toledo Bend marina",
  deep: true,
  plan: ["Toledo Bend marina", "Toledo Bend marina overview"],
  endpoint: backend.kind === "xai-adapter" ? XAI_MIND_SEARCH_ADAPTER_ENDPOINT : backend.endpoint,
  key: backend.key,
  fetchImpl,
  timeoutMs: 45_000,
  deepTimeoutMs: 90_000,
});
log(`INFO: deep ok=${deep.ok} steps=${deep.steps?.length ?? 0} partial=${Boolean(deep.partial)} cites=${deep.citations.length}`);
if (deep.report) {
  const md = researchReportToMarkdown(deep.report);
  log(`INFO: report_md_len=${md.length}`);
}

const pass = result.ok && result.citations.length > 0;
log(pass ? "PASS: live MIND_SEARCH adapter returned real source URLs" : "FAIL");
mkdirSync(resolve(root, ".handoff"), { recursive: true });
writeFileSync(resolve(root, ".handoff/RESEARCH_DEEP_LIVE.txt"), lines.join("\n") + "\n");
process.exit(pass ? 0 : 1);
